$ErrorActionPreference = "Stop"

$ProjectRoot = $PSScriptRoot
$ExtensionRoot = Join-Path $ProjectRoot "browser-extension\tn-account-importer"
$DesktopPath = [Environment]::GetFolderPath("Desktop")
$OutputFolder = Join-Path $DesktopPath "TN-account-importer-extension"
$ZipPath = Join-Path $DesktopPath "TN-account-importer-extension.zip"

if (-not (Test-Path $ExtensionRoot)) {
    Write-Host "[extension] Extension root not found: $ExtensionRoot" -ForegroundColor Red
    exit 1
}

Write-Host "[extension] Preparing Desktop output..." -ForegroundColor Cyan
if (Test-Path $OutputFolder) {
    Remove-Item -Path $OutputFolder -Recurse -Force
}
if (Test-Path $ZipPath) {
    Remove-Item -Path $ZipPath -Force
}

Copy-Item -Path $ExtensionRoot -Destination $OutputFolder -Recurse -Force

Write-Host "[extension] Creating zip package..." -ForegroundColor Cyan
Compress-Archive -Path (Join-Path $OutputFolder "*") -DestinationPath $ZipPath -Force

Write-Host "[extension] Desktop folder: $OutputFolder" -ForegroundColor Green
Write-Host "[extension] Desktop zip: $ZipPath" -ForegroundColor Green
