// Cari metadata anime (cover, total episode, skor, genre, flag adult) dari AniList, cadangan Jikan.
// Judul dicocokkan dengan similarity (bukan asal ambil hasil pertama), jadi cover salah jauh berkurang.
// Koreksi manual: data/overrides.json.
const fs = require("fs");

const OK_TTL = 24 * 60 * 60 * 1000;
const MISS_TTL = 60 * 1000;
const TIMEOUT = 6000;

const MEDIA_FIELDS = `id idMal title{romaji english native} synonyms format episodes averageScore
  genres isAdult siteUrl seasonYear coverImage{extraLarge large}`;

const norm = s => String(s || "").toLowerCase().normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

function bigrams(s) {
  const out = new Map();
  const t = s.replace(/ /g, "");
  for (let i = 0; i < t.length - 1; i++) {
    const g = t.slice(i, i + 2);
    out.set(g, (out.get(g) || 0) + 1);
  }
  return out;
}

function similarity(a, b) {
  a = norm(a); b = norm(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const A = bigrams(a), B = bigrams(b);
  let hit = 0, total = 0;
  for (const n of A.values()) total += n;
  for (const n of B.values()) total += n;
  for (const [g, n] of A) hit += Math.min(n, B.get(g) || 0);
  let score = total ? (2 * hit) / total : 0;
  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  if (short.length >= 4 && ` ${long} `.includes(` ${short} `)) {
    score = Math.max(score, 0.6 + 0.4 * (short.length / long.length));
  }
  return score;
}

const PENALTY = { SPECIAL: 0.06, OVA: 0.04, MUSIC: 0.2, CM: 0.2, PV: 0.2 };

function pickBest(cands, query, threshold) {
  let best = null;
  for (const c of cands) {
    const s = Math.max(0, ...c.names.map(n => similarity(query, n))) - (PENALTY[c.format] || 0);
    if (!best || s > best.score) best = { c, score: s };
  }
  return best && best.score >= threshold ? best.c : null;
}

function fromAniListMedia(m) {
  if (!m) return null;
  const names = [m.title?.romaji, m.title?.english, m.title?.native, ...(m.synonyms || [])].filter(Boolean);
  return {
    source: "anilist", id: m.id, malId: m.idMal || null, names, format: m.format,
    cover: m.coverImage?.extraLarge || m.coverImage?.large || null,
    episodes: m.episodes || null,
    score: m.averageScore || null,
    genres: m.genres || [],
    isAdult: Boolean(m.isAdult),
    url: m.siteUrl || null,
    year: m.seasonYear || null
  };
}

function fromJikanItem(a) {
  const names = [a.title, a.title_english, a.title_japanese, ...(a.title_synonyms || [])].filter(Boolean);
  const img = a.images?.jpg;
  return {
    source: "jikan", id: null, malId: a.mal_id, names, format: String(a.type || "").toUpperCase(),
    cover: img?.large_image_url || img?.image_url || null,
    episodes: a.episodes || null,
    score: a.score ? Math.round(a.score * 10) : null,
    genres: (a.genres || []).map(g => g.name),
    isAdult: /^rx/i.test(a.rating || ""),
    url: a.url || null,
    year: a.year || null
  };
}

class MetadataService {
  constructor({ overridesFile = null, fetchImpl = globalThis.fetch, onUpdate = null } = {}) {
    this.overridesFile = overridesFile;
    this.fetch = fetchImpl;
    this.onUpdate = onUpdate;
    this.cache = new Map();     // key -> { meta, at }
    this.inflight = new Map();  // key -> Promise
    this._ov = { mtime: 0, data: {} };
  }

  overrides() {
    if (!this.overridesFile) return {};
    try {
      const mtime = fs.statSync(this.overridesFile).mtimeMs;
      if (mtime !== this._ov.mtime) {
        const raw = JSON.parse(fs.readFileSync(this.overridesFile, "utf8"));
        const data = {};
        for (const [k, v] of Object.entries(raw)) if (v && typeof v === "object") data[norm(k)] = v;
        this._ov = { mtime, data };
      }
    } catch { this._ov = { mtime: 0, data: {} }; }
    return this._ov.data;
  }

  overrideFor(title) { return this.overrides()[norm(title)] || null; }

  key({ title, season, kind }) {
    return `${kind || "anime"}|${norm(title)}|${season || 1}|${this._ov.mtime}`;
  }

  peek(q) {
    this.overrides(); // refresh mtime biar key ikut berubah kalau file diedit
    const hit = this.cache.get(this.key(q));
    if (!hit) return undefined;
    return Date.now() - hit.at < (hit.meta ? OK_TTL : MISS_TTL) ? hit.meta : undefined;
  }

  // Dipanggil dari presence: balikin cache kalau ada, kalau belum ada mulai fetch di background.
  request(q) {
    const cached = this.peek(q);
    if (cached !== undefined) return cached;
    this.resolve(q).then(() => this.onUpdate?.(), () => {});
    return undefined;
  }

  resolve(q) {
    this.overrides();
    const key = this.key(q);
    const hit = this.peek(q);
    if (hit !== undefined) return Promise.resolve(hit);
    if (this.inflight.has(key)) return this.inflight.get(key);
    const p = this._lookup(q).then(meta => {
      this.cache.set(key, { meta, at: Date.now() });
      return meta;
    }).finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  async _json(url, init) {
    const res = await this.fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async _aniList(query, variables) {
    return this._json("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query, variables })
    });
  }

  async _searchAniList(q) {
    const json = await this._aniList(
      `query($q:String){Page(perPage:6){media(search:$q,type:ANIME,sort:SEARCH_MATCH){${MEDIA_FIELDS}}}}`, { q });
    return (json?.data?.Page?.media || []).map(fromAniListMedia);
  }

  async _byId(id) {
    const json = await this._aniList(`query($id:Int){Media(id:$id,type:ANIME){${MEDIA_FIELDS}}}`, { id });
    return fromAniListMedia(json?.data?.Media);
  }

  async _searchJikan(q) {
    const json = await this._json(
      `https://api.jikan.moe/v4/anime?q=${encodeURIComponent(q)}&limit=6&sfw=true`,
      { headers: { Accept: "application/json" } });
    return (json?.data || []).map(fromJikanItem);
  }

  async _lookup({ title, season, kind = "anime" }) {
    const ov = this.overrideFor(title) || {};
    let meta = null;

    try {
      if (ov.anilistId) meta = await this._byId(Number(ov.anilistId));
    } catch (e) { console.warn(`[AniPresence] Meta: override ID gagal (${e.message}).`); }

    if (!meta) {
      // Anime: toleran. Show/film non-anime (Netflix): ketat supaya gak salah tempel cover anime.
      const threshold = ov.search ? 0.35 : kind === "anime" ? 0.45 : 0.82;
      const base = ov.search || title;
      const queries = !ov.search && season > 1 ? [`${base} season ${season}`, base] : [base];
      outer:
      for (const q of queries) {
        for (const [name, fn] of [["AniList", x => this._searchAniList(x)], ["Jikan", x => this._searchJikan(x)]]) {
          try {
            meta = pickBest(await fn(q), q, threshold);
            if (meta) break outer;
            console.warn(`[AniPresence] Meta: ${name} gak nemu yang cocok untuk "${q}".`);
          } catch (e) {
            console.warn(`[AniPresence] Meta: ${name} gagal (${e.message}).`);
          }
        }
      }
    }

    if (!meta && !ov.cover && !ov.displayTitle) return null;
    meta = { ...(meta || { source: "override", names: [], genres: [] }) };
    if (ov.cover && /^https:\/\//i.test(ov.cover)) meta.cover = ov.cover;
    if (ov.displayTitle) meta.displayTitle = String(ov.displayTitle).slice(0, 120);
    if (typeof ov.isAdult === "boolean") meta.isAdult = ov.isAdult;
    delete meta.names;
    return meta;
  }
}

module.exports = { MetadataService, similarity, pickBest, norm, fromAniListMedia, fromJikanItem };
