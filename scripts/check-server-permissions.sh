#!/usr/bin/env bash
# Run on server to check permissions for massmail-api (PM2 usually runs as root).
# Usage: bash check-server-permissions.sh   or   bash scripts/check-server-permissions.sh

set -e
DEPLOY_PATH="${DEPLOY_PATH:-/var/www/massmail}"

echo "=== Checking $DEPLOY_PATH ==="
ls -la "$DEPLOY_PATH" 2>/dev/null || { echo "Directory missing or not readable"; exit 1; }

echo ""
echo "=== Frontend dist ==="
ls -la "$DEPLOY_PATH/frontend/dist" 2>/dev/null || { echo "frontend/dist missing or not readable"; exit 1; }
echo "index.html:"
ls -l "$DEPLOY_PATH/frontend/dist/index.html" 2>/dev/null || echo "index.html missing"
echo "assets (first 5):"
ls -l "$DEPLOY_PATH/frontend/dist/assets" 2>/dev/null | head -5 || echo "assets/ missing"

echo ""
echo "=== Backend ==="
ls -la "$DEPLOY_PATH/backend" 2>/dev/null | head -10
echo ".env readable?"
test -r "$DEPLOY_PATH/backend/.env" && echo "  yes" || echo "  NO - fix: chmod 640 $DEPLOY_PATH/backend/.env"
echo "dist/index.js:"
ls -l "$DEPLOY_PATH/backend/dist/index.js" 2>/dev/null || echo "  missing"

echo ""
echo "=== Process user (who runs PM2) ==="
whoami
id

echo ""
echo "=== Suggested fix if backend cannot read frontend ==="
echo "  sudo chown -R root:root $DEPLOY_PATH/frontend/dist"
echo "  sudo chmod -R 755 $DEPLOY_PATH/frontend/dist"
echo "  sudo chmod 640 $DEPLOY_PATH/backend/.env"
