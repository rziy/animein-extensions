// Adapter per situs. Tiap adapter: test(host), read() -> meta | null | { skip: true, reason? }.
//  - meta  : info judul/episode yang dibaca dari halaman
//  - null  : frame ini cuma punya video, info judul diambil dari frame utama (lihat background.js)
//  - skip  : jangan kirim apa-apa (bukan halaman nonton, iklan, embed, dst)
(() => {
  "use strict";
  const T = el => (el?.textContent || "").replace(/\s+/g, " ").trim();
  const Q = (sels, root = document) => {
    for (const s of sels) { const t = T(root.querySelector(s)); if (t) return t; }
    return "";
  };
  const isTop = window.top === window;

  const youtube = {
    id: "youtube", site: "YouTube", kind: "video", minDuration: 20,
    test: h => /^(www\.|m\.)?youtube\.com$/.test(h),
    read() {
      const p = location.pathname;
      if (!p.startsWith("/watch")) return { skip: true };
      const v = new URLSearchParams(location.search).get("v");
      if (!v) return { skip: true };
      if (document.querySelector("#movie_player.ad-showing, .html5-video-player.ad-showing")) {
        return { skip: true, reason: "ad" };
      }
      const title = Q(["ytd-watch-metadata h1 yt-formatted-string", "h1.ytd-watch-metadata", "#title h1"])
        || document.title.replace(/^\(\d+\)\s*/, "").replace(/\s*-\s*YouTube$/, "");
      const channel = Q([
        "ytd-watch-metadata ytd-channel-name a", "#owner ytd-channel-name a", "#upload-info ytd-channel-name a"
      ]);
      return {
        title, channel,
        thumbnail: `https://i.ytimg.com/vi/${encodeURIComponent(v)}/hqdefault.jpg`,
        url: `https://www.youtube.com/watch?v=${encodeURIComponent(v)}`
      };
    }
  };

  // Netflix menyembunyikan overlay judul saat kontrol hilang, jadi hasil terakhir di-cache per video.
  const nfCache = new Map();
  const netflix = {
    id: "netflix", site: "Netflix", kind: "show", minDuration: 120,
    test: h => /(^|\.)netflix\.com$/.test(h),
    read() {
      const m = location.pathname.match(/^\/watch\/(\d+)/);
      if (!m) return { skip: true };
      const box = document.querySelector('[data-uia="video-title"]');
      if (box) {
        const parts = [...box.querySelectorAll("h4, span")].map(T).filter(Boolean);
        const title = T(box.querySelector("h4")) || parts[0] || T(box);
        const rest = parts.filter(p => p !== title);
        const epRx = /^(?:S\d+\s*:?\s*)?(?:E|Ep\.?|Episode)\s*\d+$/i;
        const ep = rest.find(p => epRx.test(p)) || "";
        const meta = {
          title, episodeText: ep, episodeTitle: rest.find(p => p !== ep) || "",
          url: `https://www.netflix.com/watch/${m[1]}`
        };
        if (title) nfCache.set(m[1], meta);
        return meta;
      }
      return nfCache.get(m[1]) || null;
    }
  };

  // Crunchyroll: video ada di iframe (static.crunchyroll.com), judul ada di halaman utama.
  const crunchyroll = {
    id: "crunchyroll", site: "Crunchyroll", kind: "anime", minDuration: 90,
    test: h => /(^|\.)crunchyroll\.com$/.test(h),
    read() {
      if (!isTop) return null;
      if (!/\/watch\//.test(location.pathname)) return { skip: true };
      const fromTitle = document.title.replace(/^Watch\s+/i, "").replace(/\s*[-|–]\s*Crunchyroll.*$/i, "");
      const show = Q(['[data-t="show-title-link"] h4', "a.show-title-link h4", 'a[href*="/series/"] h4']);
      const ep = Q(['h1.title', '[data-t="episode-title"]', "h1"]);
      return {
        title: show || fromTitle,
        episodeText: ep || fromTitle,
        episodeTitle: ep,
        url: location.href.split(/[?#]/)[0]
      };
    }
  };

  // Situs anime lain (Animein, Oploverz, Samehadaku, Anoboy, ...): baca heading halaman.
  const generic = {
    id: "web", site: "", kind: "anime", minDuration: 90,
    test: () => true,
    read() {
      return { title: findTitle(), episodeText: findEpisodeHint() };
    }
  };

  function findTitle() {
    const selectors = ["h1.entry-title", "h1.post-title", "h1.anime-title", "article h1", "main h1", "h1"];
    for (const selector of selectors) {
      const value = T(document.querySelector(selector));
      if (value && value.length < 180) return value;
    }
    return (document.title || location.hostname)
      .replace(/\s*[-|–—]\s*(Oploverz|Samehadaku|Anoboy|Animein Web).*$/i, "").trim();
  }

  // Animein (SPA): URL & judul tab gak berubah per episode, jadi episode aktif diambil dari
  // tombol aria-current="true" bertitle "Episode N".
  function findEpisodeHint() {
    const rx = /\b(?:episode|eps?)\s*\.?\s*\d{1,4}\b/i;
    for (const el of document.querySelectorAll('[aria-current="true"]')) {
      const label = el.getAttribute("title") || el.getAttribute("aria-label") || T(el);
      if (label && label.length < 80 && rx.test(label)) return label.trim();
    }
    for (const el of document.querySelectorAll("h1, h2, h3, h4, p")) {
      const t = T(el);
      if (t && t.length < 40 && /^(?:episode|eps?)\s*\.?\s*\d{1,4}$/i.test(t)) return t;
    }
    return "";
  }

  const host = location.hostname.replace(/^www\./, "");
  window.__aniAdapter = [youtube, netflix, crunchyroll].find(a => a.test(host)) || generic;
})();
