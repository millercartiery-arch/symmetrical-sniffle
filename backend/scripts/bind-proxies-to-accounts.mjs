#!/usr/bin/env node
/**
 * 为 Ready 账号批量绑定代理（便于在服务器上一键打通发信链路）
 * 用法（在 backend 目录下，会读取 .env）:
 *   node scripts/bind-proxies-to-accounts.mjs
 * 将把前 N 个启用代理按顺序绑定到前 N 个 Ready 账号（未绑定过的）。
 */
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import mysql from 'mysql2/promise';

function loadEnv() {
  const envPath = join(process.cwd(), '.env');
  if (!existsSync(envPath)) return;
  const content = readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
}

loadEnv();

async function main() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'massmail',
    waitForConnections: true,
    connectionLimit: 5,
  });

  try {
    const [accounts] = await pool.query(
      `SELECT id FROM accounts WHERE status = 'Ready' ORDER BY id ASC LIMIT 50`
    );
    const [proxies] = await pool.query(
      `SELECT id FROM proxies WHERE is_active = 1 ORDER BY id ASC LIMIT 50`
    );
    if (!accounts?.length) {
      console.log('没有 Ready 账号，请先在账号管理中把账号设为 Ready。');
      return;
    }
    if (!proxies?.length) {
      console.log('没有启用的代理，请先在 IP 配置中添加并启用代理。');
      return;
    }

    const [existing] = await pool.query(
      `SELECT account_id, proxy_id FROM account_proxy_bindings WHERE is_active = 1`
    );
    const existingSet = new Set((existing || []).map((r) => `${r.account_id}:${r.proxy_id}`));

    let bound = 0;
    for (let i = 0; i < accounts.length; i++) {
      const accountId = accounts[i].id;
      const proxyId = proxies[i % proxies.length].id;
      if (existingSet.has(`${accountId}:${proxyId}`)) continue;
      try {
        await pool.query(
          `INSERT INTO account_proxy_bindings (account_id, proxy_id, session_key, is_primary, is_active)
           VALUES (?, ?, 'default', 1, 1)
           ON DUPLICATE KEY UPDATE is_primary = 1, is_active = 1`,
          [accountId, proxyId]
        );
        existingSet.add(`${accountId}:${proxyId}`);
        bound++;
        console.log('绑定 account_id=%s -> proxy_id=%s', accountId, proxyId);
      } catch (e) {
        if (e?.code === 'ER_NO_SUCH_TABLE') throw e;
        console.warn('跳过 account_id=%s proxy_id=%s: %s', accountId, proxyId, e?.message || e);
      }
    }

    console.log('\n完成。本次新增绑定: %s 条。Ready 且带代理的账号可被调度器派发任务。', bound);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e?.message || e);
  process.exitCode = 1;
});
