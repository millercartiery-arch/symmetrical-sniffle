#!/usr/bin/env node
/**
 * 执行 schema_full_create.sql，创建 massmail 库及全部表（含 accounts、message_tasks、proxies 等）。
 * 适用于本地从零建库。Windows 下无需安装 mysql 命令行。
 * 运行：npm run db:full 或 tsx scripts/run-schema-full.ts
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mysql from 'mysql2/promise';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.join(__dirname, 'schema_full_create.sql');

// 可忽略的错误码：表/索引已存在时重跑不报错
const IGNORABLE_ERRNO = new Set([1050, 1061, 1060]);
// 1050 Table already exists, 1061 Duplicate key name, 1060 Duplicate column name

async function main() {
  const sql = fs.readFileSync(schemaPath, 'utf8');
  const statements = sql
    .split(/;\s*[\r\n]+/)
    .map((s) => s.replace(/^\s*--[^\n]*\n?/gm, '').trim())
    .filter((s) => s.length > 0 && !s.startsWith('--'));

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: +(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD ?? '',
  });
  try {
    for (const stmt of statements) {
      try {
        await conn.query(stmt);
      } catch (e: any) {
        if (e?.errno && IGNORABLE_ERRNO.has(e.errno)) {
          // 表/索引已存在，跳过
          continue;
        }
        throw e;
      }
    }
    console.log('✅ schema_full_create.sql 已执行，表已创建（含 accounts、message_tasks、proxies 等）');
  } finally {
    await conn.end();
  }
  process.exit(0);
}

main().catch((e) => {
  console.error('❌ 执行失败:', e.message);
  process.exit(1);
});
