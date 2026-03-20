#!/usr/bin/env node
/**
 * 快速分析 backend/logs/requests.audit.log
 * 用法: node backend/scripts/analyze-audit-log.cjs [日志文件路径]
 */
const fs = require("fs");
const path = require("path");

const defaultLog = path.join(__dirname, "..", "logs", "requests.audit.log");
const logPath = process.argv[2] || defaultLog;

if (!fs.existsSync(logPath)) {
  console.error("Log file not found:", logPath);
  process.exit(1);
}

const lines = fs.readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean);
const entries = lines.map((line) => {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}).filter(Boolean);

const byStatus = {};
const byPath = {};
let errors = [];

entries.forEach((e) => {
  byStatus[e.status] = (byStatus[e.status] || 0) + 1;
  const key = `${e.method} ${e.path}`;
  byPath[key] = (byPath[key] || 0) + 1;
  if (e.status >= 400) {
    errors.push({ at: e.at, method: e.method, path: e.path, status: e.status });
  }
});

console.log("========== 请求审计日志摘要 ==========\n");
console.log("总请求数:", entries.length);
console.log("\n按状态码:");
Object.keys(byStatus)
  .sort((a, b) => Number(a) - Number(b))
  .forEach((s) => console.log("  ", s, ":", byStatus[s]));

console.log("\n按路径 (出现次数从高到低):");
Object.entries(byPath)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 20)
  .forEach(([k, v]) => console.log("  ", v, " ", k));

if (errors.length > 0) {
  console.log("\n最近 15 条 4xx/5xx 错误:");
  errors
    .slice(-15)
    .reverse()
    .forEach((e) => console.log("  ", e.at, e.status, e.method, e.path));
}

console.log("\n========================================");
