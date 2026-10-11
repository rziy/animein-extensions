const KINDS = new Set(["anime", "show", "video"]);

function cleanText(value, max = 180) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

// "one-piece-episode-1100" / "One_Piece.Eps.1100" -> kata biasa, biar pola \b jalan di slug URL juga.
function toWords(value) {
  let s = String(value ?? "");
  try { s = decodeURIComponent(s); } catch { /* biarin mentah */ }
  return s.replace(/[-_./+]+/g, " ").replace(/\s+/g, " ").trim();
}

// Cari season/episode dari semua petunjuk (URL, judul tab, dst). Episode sampai 4 digit.
function parseWith(loose, sources) {
  let season = null;
  let episode = null;
  for (const raw of sources) {
    const s = toWords(raw);
    if (!s) continue;

    const sxe = s.match(/\bS\s*0?(\d{1,2})\s*E\s*0?(\d{1,4})\b/i);
    if (sxe) {
      season ??= Number(sxe[1]);
      episode ??= Number(sxe[2]);
    }
    if (season == null) {
      const m = s.match(/\bseason\s*0?(\d{1,2})\b/i)
        || s.match(/\b(\d{1,2})(?:st|nd|rd|th)\s+season\b/i)
        || (loose ? s.match(/\bs\s*0?(\d{1,2})\b/i) : null);
      if (m) season = Number(m[1]);
    }
    if (episode == null) {
      const m = s.match(/\b(?:episode|eps?)\s*\.?\s*0?(\d{1,4})\b/i);
      if (m) episode = Number(m[1]);
    }
    if (season != null && episode != null) break;
  }
  return { season, episode };
}

const parseSeasonEpisode = (...sources) => parseWith(true, sources);
// Untuk URL/judul tab: tanpa pola longgar "s2" yang gampang salah kena slug.
const parseHint = (...sources) => parseWith(false, sources);

// Teks yang SUDAH dipastikan label episode (dari tombol/heading/adapter), jadi boleh lebih longgar:
// "E5", "S2:E5", "Ep. 5", "Episode 5", "#5", "5".
function parseEpisodeText(value) {
  const s = toWords(value);
  if (!s) return { season: null, episode: null };
  const strict = parseSeasonEpisode(s);
  if (strict.episode != null) return strict;
  const sE = s.match(/\bS\s*0?(\d{1,2})\s*[: ]\s*E\s*0?(\d{1,4})\b/i);
  if (sE) return { season: Number(sE[1]), episode: Number(sE[2]) };
  const loose = s.match(/(?:^|\s)(?:E|#)\s*0?(\d{1,4})\b/i) || s.match(/^0?(\d{1,4})$/);
  return { season: strict.season, episode: loose ? Number(loose[1]) : null };
}

function stripMarkers(text) {
  return text
    .replace(/\b(?:season|s)\s*0?\d{1,2}\b/ig, "")
    .replace(/\b\d{1,2}(?:st|nd|rd|th)\s+season\b/ig, "")
    .replace(/\b(?:episode|eps?)\s*\.?\s*0?\d{1,4}\b/ig, "")
    .replace(/\bS\d{1,2}\s*E0?\d{1,4}\b/ig, "")
    .replace(/[\[\](){}|_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseAnimeMetadata(rawTitle, pageTitle = "") {
  const source = cleanText(rawTitle || pageTitle, 240)
    .replace(/\.(mkv|mp4|webm)$/i, "")
    .replace(/\s*[-|]\s*(Oploverz|Samehadaku|Anoboy|Animein Web|Crunchyroll).*$/i, "")
    .trim();
  const { season, episode } = parseSeasonEpisode(source);
  return { title: cleanText(stripMarkers(source) || source || "Anime"), season, episode };
}

const posInt = v => (Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : null);

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
}

function normalizeSession(input = {}) {
  const kind = KINDS.has(input.kind) ? input.kind : "anime";
  const rawTitle = cleanText(input.title);
  let title = rawTitle;
  let season = null;
  let episode = null;

  if (kind === "anime") {
    // Judul dibersihkan dari "Season 2 / Episode 5" supaya cover & tampilan rapi.
    const meta = parseAnimeMetadata(input.title, input.pageTitle);
    title = meta.title;
    season = meta.season;
    episode = meta.episode;
    // episodeText (isi halaman) paling depan: Animein itu SPA, URL/judul tab gak berubah per episode.
    const fromText = parseEpisodeText(input.episodeText);
    // referrer sengaja gak dipakai: itu halaman SEBELUMNYA (bisa anime lain).
    const hinted = parseHint(
      input.path, input.tabUrl, input.url, input.tabTitle, input.pageTitle, input.ogTitle, input.title
    );
    season = fromText.season ?? season ?? hinted.season;
    episode = fromText.episode ?? episode ?? hinted.episode;
  } else if (kind === "show") {
    ({ season, episode } = parseEpisodeText(input.episodeText));
  }

  const currentTime = Number(input.currentTime);
  const duration = Number(input.duration);
  const url = cleanText(input.url || "", 500);
  const source = cleanText(input.source || hostOf(url) || "browser", 60);
  return {
    kind,
    siteId: cleanText(input.siteId || "web", 30).toLowerCase(),
    site: cleanText(input.site || hostOf(url) || source, 40),
    title: title || rawTitle || "Anime",
    season: posInt(input.season) ?? season,
    episode: posInt(input.episode) ?? episode,
    episodeTitle: cleanText(input.episodeTitle, 120),
    channel: cleanText(input.channel, 100),
    thumbnail: /^https:\/\//i.test(input.thumbnail || "") ? cleanText(input.thumbnail, 300) : "",
    currentTime: Number.isFinite(currentTime) && currentTime >= 0 ? currentTime : 0,
    duration: Number.isFinite(duration) && duration > 0 ? duration : null,
    paused: Boolean(input.paused),
    source,
    url,
    tabId: Number.isInteger(input.tabId) ? input.tabId : null,
    updatedAt: Date.now()
  };
}

module.exports = {
  cleanText, hostOf, parseSeasonEpisode, parseEpisodeText, parseAnimeMetadata, normalizeSession
};
