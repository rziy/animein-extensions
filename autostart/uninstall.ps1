$lnk = Join-Path ([Environment]::GetFolderPath("Startup")) "AniPresence.lnk"
Remove-Item $lnk -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like "*src\main.js*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Write-Host "Autostart dihapus dan companion dihentikan."
