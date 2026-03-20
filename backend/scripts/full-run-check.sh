#!/usr/bin/env bash
# ------------------------------------------------------------------------------
# 全局打通验证脚本（Staging/预生产）。在 backend 目录下执行：bash scripts/full-run-check.sh
# 依赖：.env、Node 20+、MySQL、Redis、npm ci、可选 pm2
# ------------------------------------------------------------------------------
set -euo pipefail
cd "$(dirname "$0")/.."

echo "========== 全局打通检查 =========="

if [[ -f .env ]]; then
  echo "🔧 加载 .env"
  set -a
  source .env 2>/dev/null || true
  set +a
else
  echo "❌ .env 未找到，请先创建"
  exit 1
fi

echo "📦 安装依赖 (npm ci)…"
npm ci --silent

echo "🗂 运行 DB 表结构确保 (db:ensure)…"
npm run db:ensure

echo "🌱 插入测试种子数据 (credential / card_key / sub_account / proxy)…"
npm run seed

echo "🚀 启动 Scheduler + Worker（单进程 worker-entry，需 Redis）…"
if command -v pm2 &>/dev/null; then
  pm2 delete massmail-worker 2>/dev/null || true
  pm2 start npx --name massmail-worker -- tsx src/worker-entry.ts
  echo "⏳ 等待 Worker 就绪（5 秒）…"
  sleep 5
fi

echo "✅ 创建测试发送任务（目标号码: 13800138000，轮询约 90s）"
node scripts/send-flow-check.mjs --create-test 13800138000

if command -v pm2 &>/dev/null; then
  echo "🔎 失败任务检查 (--failures)"
  node scripts/send-flow-check.mjs --failures
  echo "📊 最近 5 条 proxy_audit（示例）"
  mysql -N -h "${DB_HOST:-127.0.0.1}" -P "${DB_PORT:-3306}" -u "${DB_USER:-root}" -p"${DB_PASSWORD:-}" "${DB_NAME:-massmail}" -e "SELECT id,proxy_id,action,operator_id,created_at FROM proxy_audit ORDER BY created_at DESC LIMIT 5;" 2>/dev/null || echo "（需安装 mysql 客户端或手动查库）"
else
  echo "[!] 未安装 pm2 时，请手动执行: node scripts/send-flow-check.mjs --failures"
fi

echo ""
echo "========== 检查结束 =========="
echo "若任务为 Sent/Success，说明调度+Worker 正常。"
echo "代理探测可调用 API: GET /api/system/proxies/status 或在前端「IP 配置」点击刷新。"
