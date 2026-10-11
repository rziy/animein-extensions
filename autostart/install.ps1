# Daftarkan AniPresence ke folder Startup Windows (tanpa admin) lalu jalankan sekarang.
$ErrorActionPreference = "Stop"
$vbs = Join-Path $PSScriptRoot "run-hidden.vbs"
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "Node.js belum terpasang / belum ada di PATH." -ForegroundColor Red; exit 1
}
$lnk = Join-Path ([Environment]::GetFolderPath("Startup")) "AniPresence.lnk"
$s = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk)
$s.TargetPath = "wscript.exe"
$s.Arguments = "`"$vbs`""
$s.WorkingDirectory = Split-Path $PSScriptRoot
$s.WindowStyle = 7
$s.Save()
if (-not (Test-Path $lnk)) { Write-Host "Gagal membuat shortcut Startup." -ForegroundColor Red; exit 1 }
Start-Process wscript.exe -ArgumentList "`"$vbs`""
Write-Host "Terpasang di Startup dan sudah dijalankan." -ForegroundColor Green
Write-Host "Cek: http://127.0.0.1:32145  |  Log: data\companion.log"
