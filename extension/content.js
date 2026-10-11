(() => {
  "use strict";
  if (window.__aniPresenceInstalled) return;
  window.__aniPresenceInstalled = true;

  const adapter = window.__aniAdapter;
  const isTop = window.top === window;
  let lastKey = "";
  let lastVideo = null;
  let lastPostAt = 0;
  let lastMetaKey = "";
  let lastMetaAt = 0;

  function post(type, path, payload) {
    try { chrome.runtime.sendMessage({ type, path, payload }); }
    catch { /* extension context bisa saja sudah di-reload */ }
  }

  function visibleArea(video) {
    const rect = video.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return 0;
    const style = getComputedStyle(video);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return 0;
    return rect.width * rect.height;
  }

  function chooseMainVideo() {
    const min = adapter.minDuration || 90;
    const videos = [...document.querySelectorAll("video")]
      .map(video => ({
        video, area: visibleArea(video), duration: video.duration,
        playing: !video.paused && !video.ended && !video.seeking
      }))
      .filter(item => item.area > 0 && Number.isFinite(item.duration) && item.duration >= min);

    const playing = videos.filter(item => item.playing).sort((a, b) => b.area - a.area);
    if (playing.length) return playing[0].video;
    if (lastVideo && videos.some(item => item.video === lastVideo)) return lastVideo;
    return null;
  }

  function stopIfNeeded() {
    if (!lastVideo) return;
    lastVideo = null;
    lastKey = "";
    post("ANIPRESENCE_POST", "/stop", {});
  }

  // Frame utama membagikan info judul ke frame video (iframe) lewat background.
  function forwardMeta(meta) {
    if (!isTop || !document.querySelector("iframe")) return;
    const payload = meta ? { ...meta, kind: meta.kind || adapter.kind, siteId: adapter.id, site: adapter.site } : null;
    if (!payload) return;
    const key = JSON.stringify(payload);
    if (key === lastMetaKey && Date.now() - lastMetaAt < 10000) return;
    lastMetaKey = key;
    lastMetaAt = Date.now();
    post("ANIPRESENCE_META", null, payload);
  }

  function scan() {
    const meta = adapter.read();
    forwardMeta(meta);

    if (meta?.skip) {
      if (meta.reason !== "ad") stopIfNeeded(); // iklan: jangan bikin presence berkedip
      return;
    }
    if (lastVideo && !lastVideo.isConnected) stopIfNeeded();

    const video = chooseMainVideo();
    if (!video) return;
    lastVideo = video;
    if (isTop && !meta?.title) return; // frame utama tapi judul belum ketemu (mis. overlay Netflix lagi hilang)

    const payload = {
      kind: meta?.kind || adapter.kind,
      siteId: adapter.id,
      site: adapter.site || location.hostname.replace(/^www\./, ""),
      title: meta?.title || document.title || location.hostname,
      episodeText: meta?.episodeText || "",
      episodeTitle: meta?.episodeTitle || "",
      channel: meta?.channel || "",
      thumbnail: meta?.thumbnail || "",
      path: location.pathname,
      referrer: document.referrer,
      ogTitle: document.querySelector('meta[property="og:title"]')?.content || "",
      currentTime: video.currentTime,
      duration: video.duration,
      paused: video.paused || video.ended,
      source: location.hostname,
      url: meta?.url || location.href,
      pageTitle: document.title
    };
    const key = JSON.stringify([
      payload.title, payload.episodeText, payload.paused,
      Math.floor(payload.currentTime / 5), Math.round(payload.duration)
    ]);
    if (key !== lastKey || Date.now() - lastPostAt > 10000) {
      lastKey = key;
      lastPostAt = Date.now();
      post("ANIPRESENCE_POST", "/session", payload);
    }
  }

  for (const ev of ["play", "pause", "loadedmetadata", "durationchange", "seeked"]) {
    document.addEventListener(ev, scan, true);
  }
  document.addEventListener("ended", () => { if (lastVideo?.ended) stopIfNeeded(); }, true);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) scan(); });
  window.setInterval(scan, 2500);
  scan();
})();
