const BRIDGE = "http://127.0.0.1:32145";
const HEADERS = { "Content-Type": "application/json", "X-AniPresence": "1" };
const FIELDS = ["kind", "siteId", "site", "title", "episodeText", "episodeTitle", "channel", "thumbnail", "url"];
const META_MAX_AGE = 60000;

// Service worker MV3 bisa tidur kapan saja, jadi meta per-tab disimpan di storage.session.
const metaKey = tabId => `meta:${tabId}`;

async function getMeta(tabId) {
  try {
    const r = await chrome.storage.session.get(metaKey(tabId));
    const m = r[metaKey(tabId)];
    return m && Date.now() - m.at < META_MAX_AGE ? m : null;
  } catch { return null; }
}

function send(path, body) {
  return fetch(`${BRIDGE}${path}`, {
    method: "POST", headers: HEADERS, body: JSON.stringify(body), cache: "no-store"
  }).catch(() => { /* companion boleh dinyalakan belakangan */ });
}

async function handle(message, sender) {
  if (!sender?.tab) return; // hanya content script milik extension ini
  const tabId = sender.tab.id;

  if (message?.type === "ANIPRESENCE_META") {
    await chrome.storage.session.set({ [metaKey(tabId)]: { ...(message.payload || {}), at: Date.now() } });
    return;
  }
  if (message?.type !== "ANIPRESENCE_POST" || !["/session", "/stop"].includes(message.path)) return;

  const payload = { ...(message.payload || {}) };
  if (message.path === "/session" && sender.frameId !== 0) {
    // Video di iframe: judul/episode yang benar ada di frame utama.
    const meta = await getMeta(tabId);
    if (meta?.skip) return;
    if (meta) for (const k of FIELDS) if (meta[k]) payload[k] = meta[k];
  }
  await send(message.path, {
    ...payload, tabId,
    tabUrl: sender.tab.url || "", tabTitle: sender.tab.title || ""
  });
}

chrome.runtime.onMessage.addListener((message, sender) => { handle(message, sender); return false; });

chrome.tabs.onRemoved.addListener(tabId => {
  chrome.storage.session.remove(metaKey(tabId)).catch(() => {});
  send("/stop", { tabId }); // server cuma menghentikan kalau tab ini yang lagi aktif
});
