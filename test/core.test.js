const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeSession, parseEpisodeText } = require("../src/core/session-normalizer");
const { similarity, pickBest, MetadataService } = require("../src/core/metadata");
const { buildActivity, Presence } = require("../src/core/presence");
const { SessionManager } = require("../src/core/manager");
const { History } = require("../src/core/history");
const { loadConfig } = require("../src/core/config");

const cfg = loadConfig({ DISCORD_CLIENT_ID: "111", MIN_UPDATE_MS: "0" });
const base = { title: "Tokyo Revengers", currentTime: 100, duration: 1400, paused: false, url: "https://animein.net/x", source: "animein.net" };

test("parser: S/E, episode 4 digit, ordinal season, bare E5", () => {
  assert.deepEqual(parseEpisodeText("S2:E5"), { season: 2, episode: 5 });
  assert.equal(parseEpisodeText("E12").episode, 12);
  assert.equal(parseEpisodeText("Episode 1100").episode, 1100);
  const s = normalizeSession({ ...base, title: "Re Zero 2nd Season Episode 7" });
  assert.equal(s.title, "Re Zero"); assert.equal(s.season, 2); assert.equal(s.episode, 7);
  const a = normalizeSession({ ...base, episodeText: "Episode 3" });
  assert.equal(a.episode, 3); assert.equal(a.season, null);
});

test("kind video/show: judul tidak dipotong, show baca episodeText", () => {
  const v = normalizeSession({ ...base, kind: "video", title: "Part 2 of my vlog S3", channel: "Foo", thumbnail: "https://i.ytimg.com/a.jpg" });
  assert.equal(v.title, "Part 2 of my vlog S3"); assert.equal(v.season, null);
  const n = normalizeSession({ ...base, kind: "show", title: "Dark", episodeText: "S2:E4", episodeTitle: "Ep" });
  assert.equal(n.season, 2); assert.equal(n.episode, 4);
});

test("similarity & pickBest menolak cocokan jelek", () => {
  assert.ok(similarity("Tokyo Revengers", "Tokyo Revengers: Tenjiku-hen") > 0.7);
  assert.ok(similarity("Dark", "Naruto") < 0.4);
  const c = [{ names: ["Naruto"], format: "TV" }, { names: ["Dark Gathering"], format: "TV" }];
  assert.equal(pickBest(c, "Dark", 0.82), null);
});

function fakeFetch(map) {
  return async url => ({ ok: true, json: async () => map(String(url)) });
}
const media = (id, romaji, extra = {}) => ({ id, idMal: id, title: { romaji, english: null, native: null }, synonyms: [], format: "TV", episodes: 12, averageScore: 81, genres: ["Action"], isAdult: false, siteUrl: `https://anilist.co/anime/${id}`, coverImage: { extraLarge: `https://img/${id}.jpg` }, ...extra });

test("metadata: AniList dipilih berdasar kemiripan, season>1 dicoba dulu", async () => {
  const seen = [];
  const m = new MetadataService({ fetchImpl: async (url, init) => {
    const q = JSON.parse(init.body).variables.q; seen.push(q);
    return { ok: true, json: async () => ({ data: { Page: { media: [media(1, "Mob Psycho 100"), media(2, "Mob Psycho 100 II")] } } }) };
  } });
  const r = await m.resolve({ title: "Mob Psycho 100", season: 2, kind: "anime" });
  assert.equal(seen[0], "Mob Psycho 100 season 2");
  assert.ok(r.cover.startsWith("https://img/"));
  assert.equal(m.peek({ title: "Mob Psycho 100", season: 2, kind: "anime" }), r);
});

test("metadata: show non-anime ketat -> null kalau mirip-mirip doang", async () => {
  const m = new MetadataService({ fetchImpl: async () => ({ ok: true, json: async () => ({ data: { Page: { media: [media(9, "Dark Gathering")] } } }) }) });
  assert.equal(await m.resolve({ title: "Dark", kind: "show" }), null);
});

test("metadata: AniList gagal -> fallback Jikan", async () => {
  const m = new MetadataService({ fetchImpl: async url => {
    if (url.includes("anilist")) return { ok: false, status: 500 };
    return { ok: true, json: async () => ({ data: [{ mal_id: 5, title: "Frieren", type: "TV", episodes: 28, score: 9.2, rating: "PG-13", images: { jpg: { large_image_url: "https://j/5.jpg" } }, url: "https://myanimelist.net/anime/5" }] }) };
  } });
  const r = await m.resolve({ title: "Frieren", kind: "anime" });
  assert.equal(r.cover, "https://j/5.jpg"); assert.equal(r.score, 92);
});

test("buildActivity: anime S1 rule, total episode, tombol, progress", () => {
  const s = normalizeSession({ ...base, episodeText: "Episode 5" });
  const a = buildActivity(s, { cover: "https://c/1.jpg", episodes: 12, score: 81, genres: ["Action"], url: "https://anilist.co/anime/1" }, cfg, 1_000_000, 100);
  assert.equal(a.type, 3); assert.equal(a.state, "Season 1 · Episode 5/12");
  assert.equal(a.largeImageKey, "https://c/1.jpg"); assert.equal(a.buttons.length, 2);
  assert.ok(a.endTimestamp > a.startTimestamp); assert.match(a.smallImageKey, /favicon/);
});

test("buildActivity: YouTube pakai thumbnail+channel; paused tanpa timestamp; adult disembunyikan", () => {
  const y = normalizeSession({ ...base, kind: "video", site: "YouTube", title: "Cool video", channel: "Chan", thumbnail: "https://i.ytimg.com/t.jpg", paused: true, url: "https://www.youtube.com/watch?v=a" });
  const a = buildActivity(y, null, cfg, 1e6, 10);
  assert.equal(a.state, "Chan · Paused"); assert.equal(a.largeImageKey, "https://i.ytimg.com/t.jpg");
  assert.equal(a.startTimestamp, undefined); assert.equal(a.buttons[0].label, "Watch Video");
  const hid = buildActivity(normalizeSession({ ...base, episodeText: "Episode 1" }), { isAdult: true, cover: "https://c" }, cfg, 1e6, 0);
  assert.equal(hid.details, "Watching something"); assert.equal(hid.largeImageKey, undefined); assert.equal(hid.buttons, undefined);
});

function fakeClient() {
  const calls = [];
  class C { constructor(o) { this.o = o; this.user = { setActivity: async a => calls.push(["set", o.clientId, a]), clearActivity: async () => calls.push(["clear", o.clientId]) }; this.h = {}; }
    on(e, f) { this.h[e] = f; } async login() { this.h.ready?.(); } async destroy() {} }
  return { C, calls };
}

test("Presence: per-site client id, throttle, clear saat ganti app", async () => {
  const { C, calls } = fakeClient();
  const c2 = loadConfig({ DISCORD_CLIENT_ID: "111", DISCORD_CLIENT_ID_YOUTUBE: "222", MIN_UPDATE_MS: "50" });
  let t = 1_000_000;
  const p = new Presence(c2, { ClientClass: C, now: () => t });
  await p.connect();
  const s = normalizeSession({ ...base, episodeText: "Episode 1" });
  await p.update(s);
  assert.equal(calls.at(-1)[1], "111");
  await p.update({ ...s, paused: true });          // berubah tapi masih di dalam jendela throttle
  assert.equal(calls.filter(c => c[0] === "set").length, 1);
  t += 100;                                        // waktu berjalan, timer menyusul
  await new Promise(r => setTimeout(r, 120));
  assert.equal(calls.filter(c => c[0] === "set").length, 2);
  t += 10_000;
  await p.update(normalizeSession({ ...base, kind: "video", siteId: "youtube", site: "YouTube", title: "Vid", thumbnail: "https://i.ytimg.com/t.jpg" }));
  assert.ok(calls.some(c => c[0] === "clear" && c[1] === "111"));
  assert.equal(calls.at(-1)[1], "222");
  await p.setEnabled(false);
  assert.equal(calls.at(-1)[0], "clear");
});

function mk(over = {}) {
  let t = 1_000_000;
  const updates = [];
  const store = { data: {}, touch() {}, flush() {} };
  const m = new SessionManager({ config: { ...cfg, pauseTimeoutMin: 1, blockedHosts: ["blocked.test"], ...over }, presence: { update: x => updates.push(x), status: () => ({}) }, history: new History(store), metadata: null, now: () => t, log() {} });
  return { m, updates, adv: ms => { t += ms; }, store };
}

test("Manager: lock tab, ambil alih saat pause, blocked host, tab close, stale, pause timeout", () => {
  const { m, updates, adv, store } = mk();
  const A = { ...base, tabId: 1, episodeText: "Episode 1" };
  assert.ok(m.accept(A).ok);
  assert.equal(m.accept({ ...base, title: "Other", tabId: 2 }).ignored, "other-tab");
  assert.equal(m.active.title, "Tokyo Revengers");
  m.accept({ ...A, paused: true });
  assert.ok(m.accept({ ...base, title: "Other", tabId: 2 }).ok);       // tab 1 pause -> tab 2 boleh
  assert.equal(m.accept({ ...base, url: "https://blocked.test/a", tabId: 3 }).ignored, "blocked");
  assert.equal(m.accept({ title: "" }).status, 400);
  assert.equal(m.stop(99), false);                                      // tab lain gak boleh stop
  assert.equal(m.stop(2), true);
  m.accept({ ...A, paused: true }); adv(14_000); m.accept({ ...A, paused: true });
  adv(61_000); m.accept({ ...A, paused: true }); m.tick();              // pause > 1 menit
  assert.equal(m.active, null);
  assert.equal(m.accept({ ...A, paused: true }).ignored, "idle");       // tidak muncul lagi saat masih pause
  assert.ok(m.accept({ ...A, paused: false }).ok);                      // lanjut nonton -> aktif lagi
  adv(20_000); m.tick(); assert.equal(m.active, null);                  // stale
  assert.ok(Object.keys(store.data.entries).length >= 2);
});

test("History: hitung waktu nonton & stats", () => {
  const store = { data: {}, touch() {}, flush() {} };
  const h = new History(store);
  const s = normalizeSession({ ...base, episodeText: "Episode 2", currentTime: 10 });
  h.record(s, null, 1_000_000); h.record({ ...s, currentTime: 15 }, null, 1_005_000); h.record({ ...s, currentTime: 20, paused: true }, null, 1_010_000);
  assert.equal(h.stats(1_010_000).totalSeconds, 5);
  assert.equal(h.list().length, 1);
});
