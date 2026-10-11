require("dotenv").config();
const fs = require("fs");
const path = require("path");
const express = require("express");
const { loadConfig } = require("./core/config");
const { JsonStore } = require("./core/store");
const { MetadataService, norm } = require("./core/metadata");
const { History } = require("./core/history");
const { Presence } = require("./core/presence");
const { SessionManager } = require("./core/manager");

const cfg = loadConfig();
const dataDir = path.resolve(cfg.dataDir);
const overridesFile = path.join(dataDir, "overrides.json");

const settings = new JsonStore(path.join(dataDir, "settings.json"), { enabled: true });
const history = new History(new JsonStore(path.join(dataDir, "history.json"), {}));
const metadata = new MetadataService({ overridesFile });
const presence = new Presence(cfg, { metadata });
metadata.onUpdate = () => presence._apply(false);
presence.enabled = settings.data.enabled !== false;
const manager = new SessionManager({ config: cfg, presence, history, metadata });

const app = express();
app.disable("x-powered-by");

// Anti DNS-rebinding: hanya terima request yang Host-nya localhost.
app.use((req, res, next) => {
  const host = String(req.headers.host || "").replace(/:\d+$/, "").toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost") return res.status(403).end();
  next();
});
// Semua POST/DELETE wajib header custom (memicu preflight CORS, jadi website lain gak bisa nembak).
app.use((req, res, next) => {
  if (req.method !== "GET" && req.get("X-AniPresence") !== "1") return res.status(403).json({ ok: false, error: "Missing header" });
  next();
});
app.use(express.json({ limit: "16kb" }));

app.get("/", (_req, res) => res.sendFile(path.join(__dirname, "ui", "index.html")));

app.get("/health", (_req, res) => {
  const snap = manager.snapshot();
  res.json({ ok: true, active: Boolean(snap.session), source: snap.session?.source || null });
});

app.post("/session", (req, res) => {
  try {
    const r = manager.accept(req.body);
    if (r.error) return res.status(r.status).json({ ok: false, error: r.error });
    if (r.ok) {
      const s = r.session;
      console.log(`[AniPresence] ${s.paused ? "Paused" : "Playing"} [${s.site}]: ${s.title} | S${s.season ?? "?"} E${s.episode ?? "?"} | ${Math.floor(s.currentTime)}s/${s.duration ? Math.round(s.duration) : "?"}s`);
    }
    res.json({ ok: true, ignored: r.ignored || null, enabled: presence.enabled });
  } catch (error) {
    console.error("[AniPresence] Payload error:", error.message);
    res.status(400).json({ ok: false, error: "Invalid session payload" });
  }
});

app.post("/stop", (req, res) => {
  const tabId = Number.isInteger(req.body?.tabId) ? req.body.tabId : null;
  manager.stop(tabId);
  res.json({ ok: true });
});

// ---- API dashboard / popup ----
app.get("/api/status", (_req, res) => res.json({ ok: true, version: "0.4.0", ...manager.snapshot() }));

app.get("/api/history", (_req, res) => res.json({ ok: true, items: history.list(), stats: history.stats() }));

app.post("/api/enabled", async (req, res) => {
  const on = Boolean(req.body?.enabled);
  settings.data.enabled = on;
  settings.touch(200);
  await presence.setEnabled(on);
  res.json({ ok: true, enabled: on });
});

app.post("/api/override", (req, res) => {
  const b = req.body || {};
  const title = String(b.title || "").trim();
  if (!title || title.length > 180) return res.status(400).json({ ok: false, error: "Invalid title" });
  let all = {};
  try { all = JSON.parse(fs.readFileSync(overridesFile, "utf8")); } catch {}
  for (const k of Object.keys(all)) if (norm(k) === norm(title)) delete all[k];
  const entry = {};
  if (b.search) entry.search = String(b.search).slice(0, 180);
  if (Number.isInteger(Number(b.anilistId)) && Number(b.anilistId) > 0) entry.anilistId = Number(b.anilistId);
  if (/^https:\/\//i.test(b.cover || "")) entry.cover = String(b.cover).slice(0, 500);
  if (b.displayTitle) entry.displayTitle = String(b.displayTitle).slice(0, 120);
  if (Object.keys(entry).length) all[title] = entry;
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(overridesFile, JSON.stringify(all, null, 2));
  presence.lastKey = "";
  presence._apply(false);
  res.json({ ok: true, saved: Boolean(Object.keys(entry).length) });
});

app.delete("/api/history/:id", (req, res) => res.json({ ok: history.remove(req.params.id) }));
app.delete("/api/history", (_req, res) => { history.clear(); res.json({ ok: true }); });

const expiry = setInterval(() => manager.tick(), 3000);
expiry.unref();

const server = app.listen(cfg.port, cfg.host, async () => {
  console.log(`[AniPresence] v0.4.0 | Dashboard: http://${cfg.host}:${cfg.port}`);
  await presence.connect();
});

let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  clearInterval(expiry);
  history.store.flush();
  settings.flush();
  await presence.destroy();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
