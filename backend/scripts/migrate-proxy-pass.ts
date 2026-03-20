#!/usr/bin/env node
/**
 * 一次性迁移：将 proxies 表中明文 password 加密写入 auth_pass_enc，并清空 password。
 * 运行前请确保已执行 ALTER TABLE proxies ADD COLUMN auth_pass_enc VARCHAR(512) NULL;
 * 使用：npm run migrate:proxy-pass（在 backend 目录下，会加载 .env）
 */
import 'dotenv/config';
import { pool } from '../src/shared/db.js';
import { encryptProxyPassword } from '../src/shared/crypto.js';

async function main() {
  const [rows]: any = await pool.query(
    'SELECT id, password FROM proxies WHERE password IS NOT NULL AND password != ""'
  );
  console.log(`[migrate-proxy-pass] 找到 ${rows?.length ?? 0} 条待迁移记录`);
  for (const r of rows || []) {
    const enc = encryptProxyPassword(String(r.password));
    await pool.query('UPDATE proxies SET auth_pass_enc = ?, password = NULL WHERE id = ?', [enc, r.id]);
    console.log(`  id=${r.id} 已加密并清空 password`);
  }
  console.log('[migrate-proxy-pass] 完成');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
