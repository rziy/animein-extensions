const BRIDGE = "http://127.0.0.1:32145";
const $ = id => document.getElementById(id);

async function refresh() {
  try {
    const s = await (await fetch(`${BRIDGE}/api/status`, { cache: "no-store" })).json();
    $("err").hidden = true;
    $("ver").textContent = `v${s.version}`;
    $("dot").className = `dot ${s.connected ? "ok" : "warn"}`;
    $("dot").title = s.connected ? "Discord tersambung" : "Discord belum tersambung";
    $("toggle").checked = s.enabled;
    const x = s.session;
    $("title").textContent = x ? x.displayTitle : "Tidak ada yang diputar";
    $("sub").textContent = x
      ? [x.site, x.season && `S${x.season}`, x.episode && `E${x.episode}`, x.paused && "Paused"].filter(Boolean).join(" · ")
      : "";
    let bg = "";
    try { bg = x?.cover ? `url("${new URL(x.cover).href}")` : ""; } catch {}
    $("cover").style.backgroundImage = bg;
  } catch {
    $("err").hidden = false;
    $("dot").className = "dot";
  }
}

$("toggle").addEventListener("change", async e => {
  await fetch(`${BRIDGE}/api/enabled`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-AniPresence": "1" },
    body: JSON.stringify({ enabled: e.target.checked })
  }).catch(() => {});
  refresh();
});

refresh();
setInterval(refresh, 2000);
