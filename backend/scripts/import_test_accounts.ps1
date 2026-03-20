$ErrorActionPreference = "Stop"

$desktopFile = Join-Path $env:USERPROFILE "Desktop\测试号.txt"
if (-not (Test-Path $desktopFile)) {
  throw "File not found: $desktopFile"
}

$lines = Get-Content -Path $desktopFile | Where-Object { $_.Trim() -ne "" }
if ($lines.Count -eq 0) {
  throw "No account lines found in: $desktopFile"
}

$accounts = @()
foreach ($line in $lines) {
  $obj = $line | ConvertFrom-Json
  $accounts += $obj
}

$payload = @{ accounts = $accounts } | ConvertTo-Json -Depth 8
$uri = "http://localhost:3000/api/tn-accounts/import"

Write-Host "Importing $($accounts.Count) accounts to $uri ..."
$resp = Invoke-RestMethod -Method POST -Uri $uri -ContentType "application/json" -Body $payload
$resp | ConvertTo-Json -Depth 8
