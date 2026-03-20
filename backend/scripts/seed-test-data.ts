#!/usr/bin/env node
/**
 * 一键种子数据：创建 credential、card_key、sub_account、proxy 并绑定，用于全链路打通验证。
 * 运行：npm run seed 或 tsx scripts/seed-test-data.ts（需在 backend 目录，.env 已配置）
 */
import 'dotenv/config';
import { pool } from '../src/shared/db.js';
import { encrypt, encryptProxyPassword } from '../src/shared/crypto.js';
import bcrypt from 'bcrypt';

const CRED_USERNAME = process.env.SEED_CRED_USERNAME || 'tn_user_demo';
const CRED_PASSWORD = process.env.SEED_CRED_PASSWORD || 'SuperSecret123';
const CARD_CODE = process.env.SEED_CARD_CODE || 'TESTCARD-2024-01';
const PROXY_HOST = process.env.SEED_PROXY_HOST || 'gw.dataimpulse.com';
const PROXY_PORT = Number(process.env.SEED_PROXY_PORT || '823');
const PROXY_USER = process.env.SEED_PROXY_USER || 'demo_user';
const PROXY_PASS = process.env.SEED_PROXY_PASS || 'DemoPass!';

async function runSql(sql: string, params: any[] = []): Promise<any> {
  const [rows] = await pool.query(sql, params);
  return rows;
}

async function runInsert(sql: string, params: any[] = []): Promise<{ insertId: number }> {
  const [result]: any = await pool.query(sql, params);
  return { insertId: result?.insertId ?? 0 };
}

async function main() {
  const conn = await pool.getConnection();
  try {
    const { ensureProxySchema } = await import('../src/shared/proxy-schema.js');
    const { ensureCardCredentialSchema } = await import('../src/shared/card-credential-schema.js');
    await ensureProxySchema(conn);
    await ensureCardCredentialSchema(conn);
  } finally {
    conn.release();
  }

  const pwdHash = await bcrypt.hash(CRED_PASSWORD, 12);
  const credRes = await runInsert(
    `INSERT INTO credentials (type, username, password_hash) VALUES ('tn_ios', ?, ?)`,
    [CRED_USERNAME, pwdHash]
  );
  const credentialId = credRes.insertId;
  console.log('✅ credential created -> id', credentialId);

  const codeEnc = encrypt(CARD_CODE);
  const codeEncBase64 = (Buffer.isBuffer(codeEnc) ? codeEnc : Buffer.from(codeEnc)).toString('base64');
  const cardRes = await runInsert(
    `INSERT INTO card_keys (code_enc, type, status, max_use, use_count, created_at) VALUES (?, 'tn_ios', 'active', 1, 0, NOW())`,
    [codeEncBase64]
  );
  const cardKeyId = cardRes.insertId;
  console.log('✅ card_key created -> id', cardKeyId);

  const subRes = await runInsert(
    `INSERT INTO sub_accounts (card_key_id, credential_id, status, enabled, tenant_id) VALUES (?, ?, 'ready', 1, 1)`,
    [cardKeyId, credentialId]
  );
  const subAccountId = subRes.insertId;
  console.log('✅ sub_account created -> id', subAccountId);

  const proxyPassEnc = encryptProxyPassword(PROXY_PASS);
  const proxyRes = await runInsert(
    `INSERT INTO proxies (protocol, host, port, username, password, auth_pass_enc, description, region, weight, is_active, status, created_at)
     VALUES ('http', ?, ?, ?, NULL, ?, 'Demo proxy for test', 'us', 1, 1, 'Active', NOW())`,
    [PROXY_HOST, PROXY_PORT, PROXY_USER, proxyPassEnc]
  );
  const proxyId = proxyRes.insertId;
  console.log('✅ proxy created -> id', proxyId);

  await runSql('UPDATE sub_accounts SET proxy_id = ? WHERE id = ?', [proxyId, subAccountId]);
  console.log('✅ proxy bound to sub_account');

  await runSql(
    'INSERT INTO proxy_audit (proxy_id, action, operator_id, detail) VALUES (?, ?, ?, ?)',
    [proxyId, 'create', '0', JSON.stringify({ note: 'seed script proxy' })]
  );

  console.log('\n🎉 Seed 完成！可使用以下 ID 做全链路验证：');
  console.log('  credentialId :', credentialId);
  console.log('  cardKeyId    :', cardKeyId);
  console.log('  subAccountId :', subAccountId);
  console.log('  proxyId      :', proxyId);
  console.log('\n创建测试任务（由调度器自动分配子账号）：');
  console.log('  node scripts/send-flow-check.mjs --create-test 13800138000\n');
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ Seed 失败', err);
  process.exit(1);
});
