# Build Tauri desktop app and copy installers to user Desktop
$ErrorActionPreference = "Stop"
$ProjectRoot = $PSScriptRoot
$DesktopPath = [Environment]::GetFolderPath("Desktop")

Write-Host "[desktop] Building frontend + Tauri (NSIS only, avoids MSI path issues)..." -ForegroundColor Cyan
Set-Location $ProjectRoot
npm run desktop:build:nsis
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$bundlePath = if ($env:CARGO_TARGET_DIR -and (Test-Path $env:CARGO_TARGET_DIR)) {
    Join-Path $env:CARGO_TARGET_DIR "release\bundle"
} else {
    Join-Path $ProjectRoot "src-tauri\target\release\bundle"
}
if (-not (Test-Path $bundlePath)) {
    Write-Host "[desktop] Bundle path not found: $bundlePath" -ForegroundColor Red
    exit 1
}

Write-Host "[desktop] Copying installers to Desktop: $DesktopPath" -ForegroundColor Cyan
$copied = 0
Get-ChildItem -Path $bundlePath -Recurse -Include "*.msi","*.exe" -File | ForEach-Object {
    Copy-Item $_.FullName -Destination $DesktopPath -Force
    Write-Host "  -> $($_.Name)" -ForegroundColor Green
    $copied++
}
if ($copied -eq 0) {
    Get-ChildItem -Path $bundlePath -Recurse -File | ForEach-Object {
        Copy-Item $_.FullName -Destination $DesktopPath -Force
        Write-Host "  -> $($_.Name)" -ForegroundColor Green
        $copied++
    }
}
Write-Host "[desktop] Done. $copied file(s) on Desktop." -ForegroundColor Green
