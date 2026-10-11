const { hostOf } = require("./session-normalizer");

const WATCHING = 3; // Discord activity type: "Watching ..."
const pad = (s, max = 128) => {
  const t = String(s ?? "").slice(0, max);
  return t.length >= 2 ? t : `${t}\u200b\u200b`.slice(0, 2); // Discord minta minimal 2 karakter
};
const isHttp = u => /^https?:\/\//i.test(u || "");

// Fungsi murni: dari sesi + metadata jadi objek activity Discord. Gampang dites.
function buildActivity(s, meta, cfg, now, cur) {
  const paused = s.paused;
  const base = { type: WATCHING, instance: false };
  if (cfg.statusDisplay != null) base.statusDisplayType = cfg.statusDisplay;

  const addProgress = a => {
    if (!paused && s.duration) {
      const elapsed = Math.min(cur, s.duration);
      a.startTimestamp = Math.floor(now - elapsed * 1000);
      a.endTimestamp = Math.floor(now + Math.max(0, s.duration - elapsed) * 1000);
    }
    return a;
  };

  // Mode privat untuk konten dewasa: tanpa judul, cover, dan tombol.
  if (cfg.hideAdult && meta?.isAdult) {
    return addProgress({ ...base, details: "Watching something", state: paused ? "Paused" : "Playing" });
  }

  const title = meta?.displayTitle || s.title;
  const parts = [];
  if (s.kind === "video") {
    parts.push(s.channel || s.site);
  } else {
    const season = s.season ?? (s.kind === "anime" && s.episode && s.episode <= cfg.maxEpForS1 ? 1 : null);
    if (season) parts.push(`Season ${season}`);
    if (s.episode) {
      const total = s.kind === "anime" && cfg.showTotalEpisodes && meta?.episodes && s.episode <= meta.episodes
        ? `/${meta.episodes}` : "";
      parts.push(`Episode ${s.episode}${total}`);
    } else if (s.episodeTitle) {
      parts.push(s.episodeTitle);
    }
    if (!parts.length) parts.push(s.kind === "anime" ? "Watching anime" : s.site);
  }
  if (paused) parts.push("Paused");

  const activity = addProgress({ ...base, details: pad(title), state: pad(parts.join(" · ")) });

  const cover = s.kind === "video" ? s.thumbnail : (meta?.cover || s.thumbnail);
  if (cover) {
    activity.largeImageKey = cover;
    const extra = [];
    if (meta?.score) extra.push(`★ ${(meta.score / 10).toFixed(1)}`);
    if (meta?.genres?.length) extra.push(meta.genres.slice(0, 3).join(", "));
    if (s.episodeTitle && s.kind !== "video") extra.unshift(s.episodeTitle);
    activity.largeImageText = pad([title, ...extra].join(" · "));
  }

  const host = hostOf(s.url);
  if (cfg.useStateIcons) {
    activity.smallImageKey = paused ? "pause" : "play";
  } else if (host) {
    activity.smallImageKey = `https://www.google.com/s2/favicons?sz=128&domain=${encodeURIComponent(host)}`;
  }
  if (activity.smallImageKey) activity.smallImageText = pad(`${paused ? "Paused" : "Playing"} · ${s.site}`, 128);

  if (cfg.showButtons) {
    const buttons = [];
    if (isHttp(s.url)) buttons.push({ label: s.kind === "video" ? "Watch Video" : "Watch", url: s.url.slice(0, 512) });
    if (s.kind === "anime" && isHttp(meta?.url)) buttons.push({ label: "View on AniList", url: meta.url });
    if (buttons.length) activity.buttons = buttons.slice(0, 2);
  }
  return activity;
}

class Presence {
  // deps: { ClientClass, metadata, now } supaya bisa dites tanpa Discord.
  constructor(config, deps = {}) {
    this.cfg = config;
    this.ClientClass = deps.ClientClass || null;
    this.metadata = deps.metadata || null;
    this.now = deps.now || Date.now;
    this.conns = new Map(); // clientId -> { client, ready, retry, warned }
    this.enabled = true;
    this.latest = null;
    this.activeClientId = null;
    this.lastKey = "";
    this.lastPos = null;
    this.lastAt = 0;
    this.lastSendAt = 0;
    this.timer = null;
  }

  Client() {
    return (this.ClientClass ||= require("@xhayper/discord-rpc").Client);
  }

  clientIdFor(s) {
    return (s && this.cfg.siteClientIds[s.siteId]) || this.cfg.clientId;
  }

  usable(id) { return Boolean(id) && id !== "YOUR_DISCORD_APPLICATION_ID"; }

  async connect() {
    if (!this.usable(this.cfg.clientId)) {
      console.warn("[AniPresence] DISCORD_CLIENT_ID belum diisi; RPC dinonaktifkan.");
      return;
    }
    await this._conn(this.cfg.clientId);
  }

  _conn(clientId) {
    let c = this.conns.get(clientId);
    if (c) return c;
    c = { client: null, ready: false, retry: null, warned: false, clientId };
    this.conns.set(clientId, c);
    return this._connect(c).then(() => c);
  }

  async _connect(c) {
    const tag = c.clientId === this.cfg.clientId ? "utama" : `…${c.clientId.slice(-4)}`;
    try {
      c.client = new (this.Client())({ clientId: c.clientId });
      c.client.on("ready", () => {
        c.ready = true; c.warned = false;
        this.lastKey = "";
        console.log(`[AniPresence] Discord RPC tersambung (${tag}).`);
        if (this.latest) this._apply(true);
      });
      c.client.on("disconnected", () => {
        c.ready = false;
        console.warn(`[AniPresence] Discord RPC terputus (${tag}).`);
        this._retry(c);
      });
      await c.client.login();
    } catch (error) {
      c.ready = false;
      console.error(`[AniPresence] Gagal menghubungkan Discord RPC (${tag}):`, error.message);
      this._retry(c);
    }
  }

  _retry(c) {
    if (c.retry) return;
    c.retry = setTimeout(async () => {
      c.retry = null;
      try { await c.client?.destroy(); } catch {}
      c.client = null;
      await this._connect(c);
    }, 5000);
    c.retry.unref?.();
  }

  setEnabled(on) {
    this.enabled = Boolean(on);
    if (!this.enabled) return this._clearAll();
    this.lastKey = "";
    return this.latest ? this._apply(true) : undefined;
  }

  async update(session) {
    if (!session) { this.latest = null; return this._clearAll(); }
    this.latest = { ...session, receivedAt: this.now() };
    if (!this.enabled) return;
    return this._apply(false);
  }

  _pos(s, now) {
    return s.paused ? s.currentTime : s.currentTime + Math.max(0, now - s.receivedAt) / 1000;
  }

  _metaFor(s) {
    if (!this.metadata) return undefined;
    // Video (YouTube) pakai thumbnail sendiri, gak perlu cari ke AniList.
    if (s.kind === "video") return undefined;
    return this.metadata.request({ title: s.title, season: s.season, kind: s.kind });
  }

  _key(s, meta) {
    return [s.title, s.season, s.episode, s.paused, Math.round(s.duration || 0), s.siteId,
      meta?.cover || "", meta?.isAdult ? 1 : 0].join("|");
  }

  async _apply(force = false) {
    const s = this.latest;
    if (!s || !this.enabled) return;
    const now = this.now();
    const meta = this._metaFor(s);
    const cur = this._pos(s, now);
    let changed = force || this._key(s, meta) !== this.lastKey;
    if (!changed && !s.paused && this.lastPos != null) {
      const expected = this.lastPos + (now - this.lastAt) / 1000;
      if (Math.abs(cur - expected) > 4) changed = true; // seek
    }
    if (!changed) return;

    // Discord membatasi update; tahan kalau terlalu rapat lalu kirim yang terbaru.
    const wait = this.lastSendAt + this.cfg.minUpdateMs - now;
    if (wait > 0) {
      if (!this.timer) {
        this.timer = setTimeout(() => { this.timer = null; this._apply(true); }, wait);
        this.timer.unref?.();
      }
      return;
    }
    await this._send(s, meta, cur, now);
  }

  async _send(s, meta, cur, now) {
    const clientId = this.clientIdFor(s);
    if (!this.usable(clientId)) return;
    const c = await this._conn(clientId);
    if (!c.ready || !c.client?.user) {
      if (!c.warned) {
        c.warned = true;
        console.warn("[AniPresence] RPC belum siap, activity belum dikirim ke Discord.");
      }
      return;
    }
    if (this.activeClientId && this.activeClientId !== clientId) {
      const old = this.conns.get(this.activeClientId);
      try { await old?.client?.user?.clearActivity(); } catch {}
    }
    this.activeClientId = clientId;
    this.lastKey = this._key(s, meta);
    this.lastPos = cur;
    this.lastAt = now;
    this.lastSendAt = now;

    const activity = buildActivity(s, meta, this.cfg, now, cur);
    try {
      await c.client.user.setActivity(activity);
      console.log(`[AniPresence] → Discord: ${activity.details} | ${activity.state}${activity.largeImageKey ? " | cover OK" : " | tanpa cover"}`);
    } catch (error) {
      this.lastKey = "";
      console.error("[AniPresence] Gagal memperbarui activity:", error.message);
    }
  }

  async _clearAll() {
    clearTimeout(this.timer);
    this.timer = null;
    this.lastKey = "";
    this.lastPos = null;
    this.activeClientId = null;
    for (const c of this.conns.values()) {
      try { await c.client?.user?.clearActivity(); } catch {}
    }
  }

  status() {
    return {
      enabled: this.enabled,
      connected: [...this.conns.values()].some(c => c.ready),
      apps: [...this.conns.values()].map(c => ({ id: `…${c.clientId.slice(-4)}`, ready: c.ready }))
    };
  }

  async destroy() {
    clearTimeout(this.timer);
    for (const c of this.conns.values()) {
      clearTimeout(c.retry);
      try { await c.client?.user?.clearActivity(); } catch {}
      try { await c.client?.destroy(); } catch {}
    }
  }
}

module.exports = { Presence, buildActivity };
