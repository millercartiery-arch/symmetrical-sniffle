# Build signed Tauri updater artifacts and regular NSIS installer.

$ErrorActionPreference = "Stop"

$ProjectRoot = $PSScriptRoot
$PrivateKeyPath = "$env:USERPROFILE\.tauri\cartier-miller-updater.key"

if (-not (Test-Path $PrivateKeyPath)) {
    throw "Missing Tauri updater private key: $PrivateKeyPath"
}

Push-Location $ProjectRoot
try {
    $env:TAURI_PRIVATE_KEY = $PrivateKeyPath
    Write-Host "Building signed updater and installer bundles ..." -ForegroundColor Cyan
    npx tauri build --bundles updater,nsis
    if ($LASTEXITCODE -ne 0) {
        throw "Updater build failed with exit code $LASTEXITCODE"
    }
}
finally {
    Remove-Item Env:TAURI_PRIVATE_KEY -ErrorAction SilentlyContinue
    Pop-Location
}
