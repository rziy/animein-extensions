// Semua pengaturan dibaca dari .env (lihat .env.example). Dipisah biar gampang dites.
const bool = (v, d) => (v == null || v === "" ? d : !/^(0|false|no|off)$/i.test(String(v).trim()));
const num = (v, d, min = -Infinity) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= min ? n : d;
};
const list = v => String(v || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);

const STATUS_DISPLAY = { name: 0, state: 1, details: 2 };
const SITE_IDS = ["YOUTUBE", "NETFLIX", "CRUNCHYROLL"];

function loadConfig(env = process.env) {
  const siteClientIds = {};
  for (const id of SITE_IDS) {
    const v = env[`DISCORD_CLIENT_ID_${id}`];
    if (v && !/^YOUR_/.test(v)) siteClientIds[id.toLowerCase()] = v.trim();
  }
  return {
    host: "127.0.0.1",
    port: num(env.PORT, 32145, 1),
    clientId: (env.DISCORD_CLIENT_ID || "").trim(),
    siteClientIds,
    enableBrowser: bool(env.ENABLE_BROWSER, true),
    dataDir: env.DATA_DIR || "data",
    maxEpForS1: num(env.MAX_EP_FOR_S1, 60, 0),
    showTotalEpisodes: bool(env.SHOW_TOTAL_EPISODES, true),
    showButtons: bool(env.SHOW_BUTTONS, true),
    hideAdult: bool(env.HIDE_ADULT, true),
    useStateIcons: bool(env.USE_STATE_ICONS, false),
    statusDisplay: STATUS_DISPLAY[String(env.STATUS_DISPLAY || "").toLowerCase()] ?? null,
    pauseTimeoutMin: num(env.PAUSE_TIMEOUT_MIN, 15, 0),
    minUpdateMs: num(env.MIN_UPDATE_MS, 4000, 0),
    blockedHosts: list(env.BLOCKED_HOSTS)
  };
}

module.exports = { loadConfig };
