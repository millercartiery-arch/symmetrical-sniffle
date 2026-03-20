#!/usr/bin/env node
/**
 * 清理本地/服务器上的旧构建产物（backend/dist、frontend/dist、Vite 缓存等）。
 * 用法：node scripts/clean.js  或  npm run clean
 */
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");

function rm(dirOrFile) {
  const full = path.join(root, dirOrFile);
  if (!fs.existsSync(full)) return;
  fs.rmSync(full, { recursive: true, force: true });
  console.log("[clean] 已删除:", dirOrFile);
}

rm("backend/dist");
rm("frontend/dist");
rm("frontend/node_modules/.vite");

const tsbuild = path.join(root, "backend", "tsconfig.tsbuildinfo");
if (fs.existsSync(tsbuild)) {
  fs.rmSync(tsbuild);
  console.log("[clean] 已删除: backend/tsconfig.tsbuildinfo");
}

console.log("[clean] 完成。可执行 npm run build 重新构建。");
