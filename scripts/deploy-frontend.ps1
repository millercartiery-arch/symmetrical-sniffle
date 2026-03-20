# Deploy frontend: build locally then upload frontend/dist to server
# Run from repo root: .\scripts\deploy-frontend.ps1
# Or: $env:DEPLOY_HOST = "root@host"; $env:DEPLOY_PATH = "/var/www/massmail"; .\scripts\deploy-frontend.ps1

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $RepoRoot "package.json"))) { $RepoRoot = (Resolve-Path (Join-Path (Get-Location) "..")).Path }
Set-Location $RepoRoot

$DeployHost = if ($env:DEPLOY_HOST) { $env:DEPLOY_HOST } else { "root@43.160.225.156" }
$DeployPath = if ($env:DEPLOY_PATH) { $env:DEPLOY_PATH } else { "/var/www/massmail" }
$FrontendDist = Join-Path (Join-Path $RepoRoot "frontend") "dist"
$RemoteDest = $DeployHost + ":" + $DeployPath + "/frontend/"

Write-Host "[deploy-frontend] Building frontend..." -ForegroundColor Cyan
& npm run build:frontend
if ($LASTEXITCODE -ne 0) { throw "npm run build:frontend failed" }

if (-not (Test-Path $FrontendDist)) { throw "frontend/dist not found" }

Write-Host "[deploy-frontend] Uploading dist to $RemoteDest" -ForegroundColor Cyan
& scp -r "$FrontendDist" $RemoteDest
if ($LASTEXITCODE -ne 0) { throw "scp upload failed" }

Write-Host "[deploy-frontend] Restarting PM2..." -ForegroundColor Cyan
& ssh $DeployHost "pm2 restart massmail-api"
if ($LASTEXITCODE -ne 0) { throw "pm2 restart failed" }

Write-Host "[deploy-frontend] Done. Frontend deployed to $DeployPath/frontend/dist" -ForegroundColor Green
