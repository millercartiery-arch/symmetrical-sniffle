/**
 * 验证代理模块与数据库连接：proxies / account_proxy_bindings 表与连接池
 * 运行: cd backend && npx tsx scripts/check_proxy_db.ts
 */
import 'dotenv/config';
import { pool } from '../src/shared/db.js';
import { ensureProxySchema } from '../src/shared/proxy-schema.js';

async function main() {
  console.log('Checking DB connection and proxy schema...');
  const conn = await pool.getConnection();
  try {
    const [tables] = await conn.query("SHOW TABLES LIKE 'accounts'") as any[];
    if (!tables?.length) {
      console.error('FAIL: accounts 表不存在，无法创建 account_proxy_bindings。请先执行 scripts/setup_db.js 或 scripts/schema_full_create.sql');
      conn.release();
      pool.end().catch(() => {});
      process.exit(1);
    }
    await ensureProxySchema(conn);
    console.log('OK ensureProxySchema');

    const [proxies] = await conn.query('SELECT COUNT(*) as c FROM proxies');
    const [bindings] = await conn.query('SELECT COUNT(*) as c FROM account_proxy_bindings');
    console.log('OK proxies count:', (proxies as any)[0]?.c ?? 0);
    console.log('OK account_proxy_bindings count:', (bindings as any)[0]?.c ?? 0);

    console.log('\nProxy module DB check passed.');
  } catch (e: any) {
    console.error('FAIL:', e?.message || e);
    process.exit(1);
  } finally {
    conn.release();
    pool.end().catch(() => {});
  }
}

main();
