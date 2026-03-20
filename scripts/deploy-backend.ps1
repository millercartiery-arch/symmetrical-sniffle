# Deploy backend: build locally, upload dist to server, npm install and pm2 restart
# Run from repo root: .\scripts\deploy-backend.ps1
# Or: $env:DEPLOY_HOST = "root@host"; $env:DEPLOY_PATH = "/var/www/massmail"; .\scripts\deploy-backend.ps1

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $RepoRoot "package.json"))) { $RepoRoot = (Resolve-Path (Join-Path (Get-Location) "..")).Path }
Set-Location $RepoRoot

$DeployHost = if ($env:DEPLOY_HOST) { $env:DEPLOY_HOST } else { "root@43.160.225.156" }
$DeployPath = if ($env:DEPLOY_PATH) { $env:DEPLOY_PATH } else { "/var/www/massmail" }
$BackendDir = Join-Path $RepoRoot "backend"
$RemoteBackend = $DeployHost + ":" + $DeployPath + "/backend/"

Write-Host "[deploy-backend] Building backend..." -ForegroundColor Cyan
Set-Location $BackendDir
& npm run build
if ($LASTEXITCODE -ne 0) { throw "npm run build failed" }
Set-Location $RepoRoot

$DistDir = Join-Path $BackendDir "dist"
if (-not (Test-Path $DistDir)) { throw "backend/dist not found" }

Write-Host "[deploy-backend] Uploading dist and package files to $RemoteBackend" -ForegroundColor Cyan
& scp -r "$DistDir" $RemoteBackend
if ($LASTEXITCODE -ne 0) { throw "scp dist failed" }
& scp (Join-Path $BackendDir "package.json") (Join-Path $BackendDir "package-lock.json") $RemoteBackend
if ($LASTEXITCODE -ne 0) { throw "scp package failed" }

Write-Host "[deploy-backend] Installing deps and restarting PM2 on server..." -ForegroundColor Cyan
$RemoteCmd = "cd " + $DeployPath + "/backend; npm install --omit=dev; pm2 restart massmail-api"
& ssh $DeployHost $RemoteCmd
if ($LASTEXITCODE -ne 0) { throw "ssh/pm2 failed" }

Write-Host "[deploy-backend] Done. Backend deployed and restarted." -ForegroundColor Green
