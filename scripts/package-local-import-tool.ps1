$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$DesktopPath = [Environment]::GetFolderPath("Desktop")
$OutputFolder = Join-Path $DesktopPath "TN-local-import-tool"
$ZipPath = Join-Path $DesktopPath "TN-local-import-tool.zip"

if (Test-Path $OutputFolder) {
    Remove-Item -Path $OutputFolder -Recurse -Force
}
if (Test-Path $ZipPath) {
    Remove-Item -Path $ZipPath -Force
}

New-Item -ItemType Directory -Path $OutputFolder | Out-Null

Copy-Item -Path (Join-Path $ProjectRoot "frontend\tools\import_tn_accounts.py") -Destination $OutputFolder -Force
Copy-Item -Path (Join-Path $ProjectRoot "frontend\tools\README-import-tool.md") -Destination $OutputFolder -Force
Copy-Item -Path (Join-Path $ProjectRoot "frontend\data\tn_accounts_full_example.json") -Destination $OutputFolder -Force

Compress-Archive -Path (Join-Path $OutputFolder "*") -DestinationPath $ZipPath -Force

Write-Host "[import-tool] Folder: $OutputFolder" -ForegroundColor Green
Write-Host "[import-tool] Zip: $ZipPath" -ForegroundColor Green
