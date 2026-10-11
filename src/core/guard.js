// Middleware keamanan lokal: Host check, CORS khusus extension browser, dan header wajib untuk aksi tulis.
const EXT_ORIGIN = /^(chrome|moz)-extension:\/\/[a-z0-9-]+$/i;

function hostGuard(req, res, next) {
  const host = String(req.headers.host || "").replace(/:\d+$/, "").toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost") return res.status(403).end();
  next();
}

// Hanya origin extension yang boleh lintas-origin. Website biasa tetap diblokir browser.
function cors(req, res, next) {
  const origin = req.headers.origin;
  if (origin && EXT_ORIGIN.test(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-AniPresence");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Max-Age", "600");
    if (req.method === "OPTIONS") return res.status(204).end();
  } else if (req.method === "OPTIONS") {
    return res.status(403).end();
  }
  next();
}

function requireHeader(req, res, next) {
  if (req.method !== "GET" && req.method !== "HEAD" && req.get("X-AniPresence") !== "1") {
    return res.status(403).json({ ok: false, error: "Missing header" });
  }
  next();
}

module.exports = { hostGuard, cors, requireHeader, EXT_ORIGIN };
