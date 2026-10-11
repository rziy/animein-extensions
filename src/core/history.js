// Riwayat tontonan + statistik + posisi terakhir ("Continue watching" di dashboard).
const crypto = require("crypto");

const MAX_ENTRIES = 200;
const MAX_DT = 12; // detik maksimal yang dihitung per heartbeat

const day = ts => new Date(ts).toISOString().slice(0, 10);

function entryId(s) {
  const key = [s.kind, s.siteId, s.title.toLowerCase(), s.season ?? "", s.episode ?? "", s.kind === "video" ? s.url : ""].join("|");
  return crypto.createHash("sha1").update(key).digest("hex").slice(0, 10);
}

class History {
  constructor(store) {
    this.store = store;
    this.store.data.entries ??= {};
    this.store.data.daily ??= {};
    this.store.data.totalSeconds ??= 0;
    this.lastId = null;
    this.lastAt = 0;
  }

  record(s, meta, now = Date.now()) {
    const id = entryId(s);
    const d = this.store.data;
    let dt = 0;
    if (!s.paused && this.lastId === id && this.lastAt) {
      dt = Math.min(MAX_DT, Math.max(0, (now - this.lastAt) / 1000));
    }
    this.lastId = id;
    this.lastAt = now;

    const e = d.entries[id] ??= {
      id, kind: s.kind, site: s.site, title: s.title, season: s.season, episode: s.episode,
      watchedSeconds: 0, firstWatched: now, count: 0
    };
    if (e.lastWatched == null || now - e.lastWatched > 30 * 60 * 1000) e.count += 1;
    Object.assign(e, {
      site: s.site, season: s.season, episode: s.episode, episodeTitle: s.episodeTitle || e.episodeTitle || "",
      channel: s.channel || e.channel || "", url: s.url, lastWatched: now,
      position: Math.floor(s.currentTime), duration: s.duration ? Math.round(s.duration) : e.duration || null,
      cover: s.thumbnail || meta?.cover || e.cover || null
    });
    e.watchedSeconds += dt;
    e.completed = Boolean(e.duration && e.position >= e.duration * 0.93);

    if (dt) {
      d.totalSeconds += dt;
      d.daily[day(now)] = (d.daily[day(now)] || 0) + dt;
      const keys = Object.keys(d.daily).sort();
      for (const k of keys.slice(0, Math.max(0, keys.length - 90))) delete d.daily[k];
    }
    this.prune();
    this.store.touch();
    return e;
  }

  prune() {
    const all = Object.values(this.store.data.entries);
    if (all.length <= MAX_ENTRIES) return;
    all.sort((a, b) => b.lastWatched - a.lastWatched);
    for (const e of all.slice(MAX_ENTRIES)) delete this.store.data.entries[e.id];
  }

  list() {
    return Object.values(this.store.data.entries).sort((a, b) => b.lastWatched - a.lastWatched);
  }

  remove(id) {
    const had = id in this.store.data.entries;
    delete this.store.data.entries[id];
    this.store.touch(500);
    return had;
  }

  clear() {
    this.store.data.entries = {};
    this.store.touch(500);
  }

  stats(now = Date.now()) {
    const d = this.store.data;
    let week = 0;
    for (let i = 0; i < 7; i++) week += d.daily[day(now - i * 86400000)] || 0;
    return {
      totalSeconds: Math.round(d.totalSeconds),
      todaySeconds: Math.round(d.daily[day(now)] || 0),
      weekSeconds: Math.round(week),
      titles: new Set(Object.values(d.entries).map(e => `${e.kind}|${e.title}`)).size
    };
  }
}

module.exports = { History, entryId };
