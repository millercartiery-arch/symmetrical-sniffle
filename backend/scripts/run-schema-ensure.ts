#!/usr/bin/env node
/**
 * 确保 proxy、proxy_audit、credentials、card_keys、sub_accounts、contacts 等表存在。
 * 适用于已有 massmail 库且已执行过 schema_full_create.sql 的环境；若从零建库请先执行：
 *   mysql -u root -p -e "CREATE DATABASE IF NOT EXISTS massmail;"
 *   mysql -u root -p massmail < scripts/schema_full_create.sql
 * 运行：npm run db:ensure 或 tsx scripts/run-schema-ensure.ts
 */
import 'dotenv/config';
import { pool } from '../src/shared/db.js';
import { ensureProxySchema } from '../src/shared/proxy-schema.js';
import { ensureCardCredentialSchema } from '../src/shared/card-credential-schema.js';

const CONTACTS_CREATE = `
CREATE TABLE IF NOT EXISTS contacts (
  phone VARCHAR(20) PRIMARY KEY,
  name VARCHAR(100) NULL,
  pinned TINYINT(1) DEFAULT 0,
  banned TINYINT(1) DEFAULT 0,
  deleted TINYINT(1) DEFAULT 0,
  unread_count INT DEFAULT 0,
  last_activity DATETIME NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
)
`.trim();

async function ensureContacts(conn: any) {
  await conn.query(CONTACTS_CREATE);
}

async function main() {
  const conn = await pool.getConnection();
  try {
    await ensureProxySchema(conn);
    await ensureCardCredentialSchema(conn);
    await ensureContacts(conn);
    console.log('✅ Schema ensure 完成（proxies, proxy_audit, credentials, card_keys, sub_accounts, contacts 等）');
  } finally {
    conn.release();
    process.exit(0);
  }
}

main().catch((e) => {
  console.error('❌ Schema ensure 失败', e);
  process.exit(1);
});
