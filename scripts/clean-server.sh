#!/usr/bin/env bash
# ------------------------------------------------------------------------------
# 服务器端清理脚本：删除旧构建产物与缓存，便于部署新代码后不残留旧文件。
# 用法：
#   在项目根目录执行：  bash scripts/clean-server.sh
#   或在服务器上执行：  cd /path/to/desktop-build-source && bash scripts/clean-server.sh
# 可选环境变量：
#   SKIP_BACKEND_DIST=1  不删除 backend/dist
#   SKIP_FRONTEND_DIST=1 不删除 frontend/dist
#   DRY_RUN=1            只打印将要删除的路径，不实际删除
# ------------------------------------------------------------------------------
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

echo "[clean-server] 项目根目录: $REPO_ROOT"

if [[ "${DRY_RUN:-0}" == "1" ]]; then
  echo "[clean-server] DRY_RUN=1，仅列出将要删除的项，不执行删除"
  RM_CMD="echo [would remove]"
else
  RM_CMD="rm -rf"
fi

# 1. 后端构建产物
if [[ "${SKIP_BACKEND_DIST:-0}" != "1" ]]; then
  if [[ -d "$REPO_ROOT/backend/dist" ]]; then
    $RM_CMD "$REPO_ROOT/backend/dist"
    echo "[clean-server] 已清理 backend/dist"
  else
    echo "[clean-server] backend/dist 不存在，跳过"
  fi
fi

# 2. 前端构建产物
if [[ "${SKIP_FRONTEND_DIST:-0}" != "1" ]]; then
  if [[ -d "$REPO_ROOT/frontend/dist" ]]; then
    $RM_CMD "$REPO_ROOT/frontend/dist"
    echo "[clean-server] 已清理 frontend/dist"
  else
    echo "[clean-server] frontend/dist 不存在，跳过"
  fi
fi

# 3. 前端 Vite 缓存（避免旧 chunk 被引用）
if [[ -d "$REPO_ROOT/frontend/node_modules/.vite" ]]; then
  $RM_CMD "$REPO_ROOT/frontend/node_modules/.vite"
  echo "[clean-server] 已清理 frontend/node_modules/.vite"
fi

# 4. 可选：后端 tsbuildinfo（TypeScript 增量构建缓存）
if [[ -f "$REPO_ROOT/backend/tsconfig.tsbuildinfo" ]]; then
  $RM_CMD "$REPO_ROOT/backend/tsconfig.tsbuildinfo"
  echo "[clean-server] 已清理 backend/tsconfig.tsbuildinfo"
fi

echo "[clean-server] 清理完成。接下来可执行: npm run build 或按你的部署流程重新构建并重启服务。"
