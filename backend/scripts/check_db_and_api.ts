/**
 * 检查数据库连接与 API 是否正常
 * 运行: cd backend && npx tsx scripts/check_db_and_api.ts
 *
 * - 数据库：使用当前 .env 的 DB_*。在本地运行=检查本地 DB，在服务器上运行=检查服务器 DB。
 * - 会显示当前是「本地」还是「服务器」数据库（按 DB_HOST 判断）。
 * - 默认检查生产 API: https://hkd.llc/api。仅检查本机: API_BASE=http://127.0.0.1:3000 npx tsx scripts/check_db_and_api.ts
 * - 远程调试：在服务器上启后端并设 DEBUG_DB_TARGET=true，然后访问 https://你的服务器/api/health 可看到该实例连接的 DB 目标。
 */
import 'dotenv/config';
import { pool } from '../src/shared/db.js';

const PORT = Number(process.env.PORT || 3000);
const API_BASE = process.env.API_BASE || process.env.VITE_API_BASE_URL || 'https://hkd.llc/api';
const apiBaseNormalized = API_BASE.replace(/\/+$/, '');

const dbHost = process.env.DB_HOST || 'localhost';
const dbName = process.env.DB_NAME || 'massmail';
const isLocalDb = /^localhost$|^127\.0\.0\.1$/i.test(dbHost.trim());

function dbTargetLabel(): string {
  return isLocalDb ? '本地' : '服务器';
}

async function checkDb(): Promise<{ ok: boolean; message: string }> {
  try {
    const conn = await pool.getConnection();
    try {
      const [rows] = await conn.query('SELECT 1 as ping');
      const hasPing = (rows as any[])?.[0]?.ping === 1;
      if (!hasPing) throw new Error('DB ping failed');
      const [tables] = await conn.query("SHOW TABLES") as any[];
      const tableCount = Array.isArray(tables) ? tables.length : 0;
      return { ok: true, message: `连接正常（${dbTargetLabel()}），当前库表数量: ${tableCount}` };
    } finally {
      conn.release();
    }
  } catch (e: any) {
    return { ok: false, message: e?.message || String(e) };
  }
}

async function checkApi(): Promise<{ ok: boolean; message: string }> {
  const healthUrl = apiBaseNormalized.includes('/api') ? `${apiBaseNormalized}/health` : `${apiBaseNormalized}/api/health`;
  try {
    const res = await fetch(healthUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data?.ok !== true) throw new Error('health 返回 ok 不为 true');
    return { ok: true, message: `API 正常 (${res.status})` };
  } catch (e: any) {
    return { ok: false, message: e?.message || String(e) };
  }
}

async function main() {
  console.log('========== 数据库与 API 检查 ==========\n');
  console.log('数据库:', dbHost, dbName, `(${dbTargetLabel()})`);
  console.log('API:   ', apiBaseNormalized, '\n');

  const dbResult = await checkDb();
  console.log('数据库:', dbResult.ok ? '✓' : '✗', dbResult.message);

  const apiResult = await checkApi();
  console.log('API:   ', apiResult.ok ? '✓' : '✗', apiResult.message);

  if (!dbResult.ok) {
    console.log('\n数据库异常，请检查 .env 中 DB_HOST / DB_USER / DB_PASSWORD / DB_NAME 及 MySQL 服务。');
    pool.end().catch(() => {});
    process.exit(1);
  }
  if (!apiResult.ok) {
    console.log('\nAPI 未响应。若检查的是生产环境，请确认服务器上的后端已运行；若检查本机，请先启动: npm run start');
    pool.end().catch(() => {});
    process.exit(1);
  }

  console.log('\n数据库与 API 检查通过。');
  pool.end().catch(() => {});
}

main();
