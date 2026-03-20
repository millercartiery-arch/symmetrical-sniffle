#!/usr/bin/env node
/**
 * 代理密码密钥轮换：用当前 PROXY_ENC_KEY 将 auth_pass_enc 解密后重新加密写入。
 * 适用于更换 PROXY_ENC_KEY 后一次性重写密文（密钥未变时无需运行）。
 * 运行：tsx scripts/rotate-proxy-keys.ts
 */
import 'dotenv/config';
import { pool } from '../src/shared/db.js';
import { decryptProxyPassword, encryptProxyPassword } from '../src/shared/crypto.js';

async function main() {
  const [rows]: any = await pool.query(
    'SELECT id, auth_pass_enc FROM proxies WHERE auth_pass_enc IS NOT NULL'
  );
  if (!rows?.length) {
    console.log('无密文密码，无需轮换。');
    process.exit(0);
  }
  console.log(`轮换 ${rows.length} 条 proxy 密文…`);
  for (const r of rows) {
    const plain = decryptProxyPassword(r.auth_pass_enc);
    const newEnc = encryptProxyPassword(plain);
    await pool.query('UPDATE proxies SET auth_pass_enc = ? WHERE id = ?', [newEnc, r.id]);
    console.log(`  id=${r.id} 已重加密`);
  }
  console.log('完成。');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
