#!/usr/bin/env bash
# ------------------------------------------------------------------------------
# 将重构后的前端代码同步到服务器并在服务器上构建。
# 用法（在项目根目录执行）：
#   export DEPLOY_HOST=root@43.160.225.156
#   export DEPLOY_PATH=/var/www/massmail
#   bash scripts/deploy-frontend.sh
# 或一行： DEPLOY_HOST=root@43.160.225.156 DEPLOY_PATH=/var/www/massmail bash scripts/deploy-frontend.sh
# 需要：本机已安装 rsync、ssh，且能免密或输入密码登录服务器。
# ------------------------------------------------------------------------------
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

DEPLOY_HOST="${DEPLOY_HOST:-root@43.160.225.156}"
DEPLOY_PATH="${DEPLOY_PATH:-/var/www/massmail}"
FRONTEND_REMOTE="${DEPLOY_PATH}/frontend"

echo "[deploy-frontend] 同步 frontend 到 ${DEPLOY_HOST}:${FRONTEND_REMOTE} (排除 node_modules、dist) ..."
rsync -avz --delete \
  --exclude node_modules \
  --exclude dist \
  --exclude '.vite' \
  --exclude '.env.local' \
  --exclude '*.log' \
  "$REPO_ROOT/frontend/" \
  "${DEPLOY_HOST}:${FRONTEND_REMOTE}/"

echo "[deploy-frontend] 在服务器上安装依赖并构建..."
ssh "$DEPLOY_HOST" "cd ${FRONTEND_REMOTE} && npm ci && npm run build"

echo "[deploy-frontend] 重启 PM2..."
ssh "$DEPLOY_HOST" "pm2 restart all"

echo "[deploy-frontend] 完成。前端已部署到 ${FRONTEND_REMOTE}/dist，API 会托管静态文件。"
