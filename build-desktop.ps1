$ErrorActionPreference = "Stop"

Write-Host "[desktop] install deps"
npm ci

Write-Host "[desktop] run regression tests"
npm run test:scheduler-components
npm run test:subaccount-distribution-smoke

Write-Host "[desktop] build tauri installers"
npm run desktop:build

Write-Host "[desktop] done"
