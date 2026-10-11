// Otak companion: terima sesi dari extension, putuskan mana yang aktif, catat riwayat, kirim ke Presence.
const { normalizeSession, hostOf } = require("./session-normalizer");

const FRESH_MS = 12000;   // sesi dianggap masih "hidup" kalau update terakhir < 12 dtk
const STALE_MS = 15000;   // lewat ini tanpa update -> presence dihapus

const keyOf = s => `${s.kind}|${s.siteId}|${s.title}|${s.season ?? ""}|${s.episode ?? ""}`;

class SessionManager {
  constructor({ config, presence, history, metadata, now = Date.now, log = console.log }) {
    Object.assign(this, { cfg: config, presence, history, metadata, now, log });
    this.active = null;
    this.pausedSince = null;
    this.suppressed = null; // key sesi yang dimatikan karena pause kelamaan
  }

  blocked(session) {
    const host = hostOf(session.url) || session.source;
    return this.cfg.blockedHosts.some(b => host === b || host.endsWith(`.${b}`));
  }

  accept(raw) {
    if (!this.cfg.enableBrowser) return { status: 403, error: "Browser submissions disabled" };
    if (typeof raw?.title !== "string" || !raw.title.trim()) return { status: 400, error: "Invalid title" };
    const session = normalizeSession(raw);
    if (!session.title || session.title.length > 180) return { status: 400, error: "Invalid title" };
    if (this.blocked(session)) return { status: 200, ignored: "blocked" };

    const now = this.now();
    session.updatedAt = now;
    const cur = this.active;
    const fresh = cur && now - cur.updatedAt < FRESH_MS;
    // Satu tab "memegang" presence selama masih main. Tab lain baru boleh ambil alih kalau tab itu pause/berhenti.
    if (fresh && cur.tabId != null && session.tabId != null && cur.tabId !== session.tabId) {
      if (!cur.paused || session.paused) return { status: 200, ignored: "other-tab" };
    }

    const key = keyOf(session);
    if (this.suppressed === key && session.paused) return { status: 200, ignored: "idle" };
    if (!session.paused) this.suppressed = null;

    if (session.paused) {
      if (!(cur?.paused && keyOf(cur) === key && this.pausedSince)) this.pausedSince = now;
    } else {
      this.pausedSince = null;
    }

    this.active = session;
    const meta = this.metadata?.peek({ title: session.title, season: session.season, kind: session.kind });
    if (!(this.cfg.hideAdult && meta?.isAdult)) this.history?.record(session, meta, now);
    this.presence.update(session);
    return { status: 200, ok: true, session };
  }

  stop(tabId = null) {
    if (tabId != null && this.active?.tabId != null && this.active.tabId !== tabId) return false;
    this.active = null;
    this.pausedSince = null;
    this.presence.update(null);
    return true;
  }

  // Dipanggil berkala: hapus sesi basi & matikan presence kalau pause terlalu lama.
  tick() {
    const s = this.active;
    if (!s) return;
    const now = this.now();
    if (now - s.updatedAt > STALE_MS) {
      this.log("[AniPresence] Session stale; clearing activity.");
      this.stop();
    } else if (s.paused && this.cfg.pauseTimeoutMin > 0 && this.pausedSince
      && now - this.pausedSince > this.cfg.pauseTimeoutMin * 60000) {
      this.log(`[AniPresence] Pause > ${this.cfg.pauseTimeoutMin} menit; presence dimatikan sampai lanjut nonton.`);
      this.suppressed = keyOf(s);
      this.stop();
    }
  }

  snapshot() {
    const s = this.active;
    let session = null;
    if (s) {
      const meta = this.metadata?.peek({ title: s.title, season: s.season, kind: s.kind });
      const live = s.paused ? s.currentTime : s.currentTime + Math.max(0, this.now() - s.updatedAt) / 1000;
      session = {
        ...s,
        position: s.duration ? Math.min(live, s.duration) : live,
        cover: s.kind === "video" ? s.thumbnail : (meta?.cover || s.thumbnail || null),
        displayTitle: meta?.displayTitle || s.title,
        meta: meta ? { episodes: meta.episodes, score: meta.score, genres: meta.genres, url: meta.url, isAdult: meta.isAdult } : null
      };
    }
    return { ...this.presence.status(), session };
  }
}

module.exports = { SessionManager, keyOf };
