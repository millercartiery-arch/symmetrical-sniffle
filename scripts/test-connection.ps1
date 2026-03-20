# 测试配置连接（前端 API 地址 + 可选后端 DB/API）
# 用法：在项目根目录执行 .\scripts\test-connection.ps1
# 仅测 API：.\scripts\test-connection.ps1 -ApiOnly
# 指定 API 地址：.\scripts\test-connection.ps1 -ApiBase "http://127.0.0.1:3000/api"

param(
    [switch]$ApiOnly,
    [string]$ApiBase = ""
)

$ErrorActionPreference = "Stop"

# 读取前端生产环境 API 配置
$envProd = "frontend\.env.production"
if (Test-Path $envProd) {
    Get-Content $envProd | ForEach-Object {
        if ($_ -match "^\s*VITE_API_BASE_URL=(.+)$") { $script:ViteApiBase = $matches[1].Trim() }
        if ($_ -match "^\s*VITE_API_URL=(.+)$")     { $script:ViteApiUrl = $matches[1].Trim() }
    }
}

if (-not $ApiBase) { $ApiBase = $ViteApiBase }
if (-not $ApiBase) { $ApiBase = "https://hkd.llc/api" }

$healthUrl = $ApiBase.TrimEnd("/") + "/health"
Write-Host "========== 测试配置连接 ==========" -ForegroundColor Cyan
Write-Host ""
Write-Host "配置来源: $envProd" -ForegroundColor Gray
Write-Host "API 地址: $ApiBase" -ForegroundColor Gray
Write-Host "健康检查: $healthUrl" -ForegroundColor Gray
Write-Host ""

# 测试 API
Write-Host "正在请求 API 健康检查..." -ForegroundColor Yellow
try {
    $resp = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 10
    if ($resp.StatusCode -eq 200) {
        $body = $resp.Content | ConvertFrom-Json -ErrorAction SilentlyContinue
        if ($body.ok -eq $true) {
            Write-Host "API:   " -NoNewline; Write-Host " 通过 " -ForegroundColor Green -NoNewline; Write-Host " (HTTP $($resp.StatusCode))"
        } else {
            Write-Host "API:   " -NoNewline; Write-Host " 异常 " -ForegroundColor Red -NoNewline; Write-Host " (返回 ok 不为 true)"
        }
    } else {
        Write-Host "API:   " -NoNewline; Write-Host " 异常 " -ForegroundColor Red -NoNewline; Write-Host " (HTTP $($resp.StatusCode))"
    }
} catch {
    Write-Host "API:   " -NoNewline; Write-Host " 失败 " -ForegroundColor Red -NoNewline; Write-Host " $($_.Exception.Message)"
}

if (-not $ApiOnly) {
    Write-Host ""
    Write-Host "数据库与完整 API 检查请执行:" -ForegroundColor Gray
    Write-Host "  cd backend && npx tsx scripts/check_db_and_api.ts" -ForegroundColor Gray
    Write-Host "仅测本机 API:" -ForegroundColor Gray
    Write-Host "  `$env:API_BASE='http://127.0.0.1:3000/api'; cd backend; npx tsx scripts/check_db_and_api.ts" -ForegroundColor Gray
}

Write-Host ""
