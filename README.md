# AniPresence v0.4.0

Extension Brave/Chrome mendeteksi video yang lagi diputar, companion Node.js lokal mengirimnya ke Discord Rich Presence.
Mendukung situs anime umum (Animein, Oploverz, Samehadaku, Anoboy), **Crunchyroll, Netflix, dan YouTube**.

## Fitur
- Status **Watching** + cover otomatis (AniList, cadangan Jikan), `Season 1 · Episode 5/12`, progress bar, ikon situs.
- Pencocokan cover pakai similarity dan sadar season, jadi jarang salah. Kalau tetap salah: **Fix cover** di dashboard.
- YouTube: thumbnail + nama channel, iklan diabaikan. Netflix & Crunchyroll: judul, episode, judul episode.
- Dashboard `http://127.0.0.1:32145`: now playing live, Continue Watching (posisi terakhir), statistik waktu nonton, toggle share.
- Popup extension: status Discord, now playing, toggle share.
- Satu tab "memegang" presence selama masih main (gak rebutan antar tab). Tab ditutup, presence langsung hilang.
- Update ke Discord di-throttle, cover diambil di background (presence muncul dulu, cover menyusul).
- Privasi: `HIDE_ADULT`, `BLOCKED_HOSTS`, auto-clear kalau pause lama (`PAUSE_TIMEOUT_MIN`), semua data lokal.
- Opsional: app Discord terpisah per situs, biar header jadi "Watching Crunchyroll / YouTube / Netflix".

## Setup
1. Buat application di https://discord.com/developers/applications, salin **Application ID** (bukan token).
2. `Copy-Item .env.example .env`, isi `DISCORD_CLIENT_ID`, lalu `npm install` dan `npm start`.
3. Di `brave://extensions` aktifkan Developer mode, **Load unpacked**, pilih folder `extension`.
   Kalau upgrade dari versi lama: klik **Reload** di kartu extension (izin `storage` baru).
4. Putar video. Buka dashboard untuk cek.

Upgrade dari v0.3: timpa semua file kecuali `.env`. Dependency gak berubah.

## Jalan otomatis (Windows)
Biar gak perlu `npm start` tiap hari, jalankan sekali di PowerShell dari folder project:
```powershell
powershell -ExecutionPolicy Bypass -File autostart\install.ps1
```
Companion jalan tersembunyi tiap login (lewat shortcut di folder Startup, tanpa admin), log di `data\companion.log`. Lepas dengan `autostart\uninstall.ps1`.
Kalau ubah `.env`, hentikan dulu pakai uninstall lalu install lagi (atau restart PC).

## Header "Watching ..."

- Header mengikuti nama application di Developer Portal.
- `STATUS_DISPLAY=details` membuat judul tontonan jadi header (butuh library RPC yang mendukung; kalau gak berubah: `npm i @xhayper/discord-rpc@latest`).
- Per situs: isi `DISCORD_CLIENT_ID_CRUNCHYROLL` / `_YOUTUBE` / `_NETFLIX` dengan Application ID app terpisah.

## Ikon play/pause (opsional)
Upload `assets/play.png` dan `assets/pause.png` ke Developer Portal, Rich Presence, Art Assets (key: `play`, `pause`), lalu `USE_STATE_ICONS=true`.

## Koreksi manual
Lewat dashboard (Fix cover) atau edit `data/overrides.json` (contoh: `data/overrides.example.json`). Bisa isi `anilistId`, `search`, `displayTitle`, `cover`.

## Batasan
- Hanya video HTML5 yang bisa diakses. DRM yang menyembunyikan elemen video atau player canvas gak terdeteksi.
- Selector Crunchyroll dan Netflix ditulis dari struktur halaman yang umum dan belum diuji di akun asli; kalau judul/episode salah, kirim log terminal + judulnya.
- Live stream YouTube dilewati. Tombol di presence hanya terlihat di profil orang lain.
- Situs lain dibaca secara generik (heading halaman); blokir yang gak mau dibagikan lewat `BLOCKED_HOSTS`.

## Tes
`npm test` (Node 18+, tanpa dependency tambahan).

## Tes manual bridge
```powershell
$body = @{ title="Tokyo Revengers"; season=4; episode=1; currentTime=100; duration=1468; paused=$false; source="manual-test"; url="https://example.invalid/watch" } | ConvertTo-Json
Invoke-RestMethod -Uri http://127.0.0.1:32145/session -Method Post -ContentType "application/json" -Headers @{ "X-AniPresence"="1" } -Body $body
```
Port 32145 hanya di 127.0.0.1; jangan diekspos ke internet.
