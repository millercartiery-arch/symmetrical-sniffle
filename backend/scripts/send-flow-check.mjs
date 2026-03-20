#!/usr/bin/env node
/**
 * 发信打通检查：Redis、DB、Ready 账号、代理绑定、待执行任务
 * 用法（在 backend 目录下）:
 *   node scripts/send-flow-check.mjs                    检查链路 + 统计
 *   node scripts/send-flow-check.mjs --status           查看最近 15 条发送任务状态
 *   node scripts/send-flow-check.mjs --status 18706956266  查看发往该号码的任务
 *   node scripts/send-flow-check.mjs --failures          检查失败原因（最近失败任务 + 完整错误信息，含账号代理）
 *   node scripts/send-flow-check.mjs --failures-by-ip URL 仅显示使用该代理的失败任务（如 --failures-by-ip "http://10.1.2.3:1080"）
 *   node scripts/send-flow-check.mjs --create-test 您的手机号  插入测试任务并轮询 90 秒
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

async function loadEnv() {
  try {
    const path = await import('path');
    const fs = await import('fs');
    const envPath = path.join(process.cwd(), '.env');
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      for (const line of content.split('\n')) {
        const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
        if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
      }
    }
  } catch (_) {}
}

const REDIS_URL = process.env.REDIS_URL || process.env.REDIS_HOST
  ? `redis://${process.env.REDIS_PASSWORD ? `:${process.env.REDIS_PASSWORD}@` : ''}${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || 6379}`
  : 'redis://localhost:6379';

async function checkRedis() {
  try {
    const Redis = (await import('ioredis')).default;
    const redis = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
      connectTimeout: 3000,
      retryStrategy: () => null,
    });
    await redis.connect();
    const pong = await redis.ping();
    await redis.quit();
    return { ok: true, message: `Redis PING: ${pong}` };
  } catch (e) {
    return { ok: false, message: e?.message || String(e) };
  }
}

async function checkDb() {
  try {
    const mysql = await import('mysql2/promise');
    const pool = mysql.createPool({
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT) || 3306,
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'massmail',
      waitForConnections: true,
      connectionLimit: 2,
    });
    const [rows] = await pool.query('SELECT 1 AS ping');
    await pool.end();
    const ok = rows && rows[0] && rows[0].ping === 1;
    return { ok, message: ok ? 'DB 连接正常' : 'DB ping 异常' };
  } catch (e) {
    return { ok: false, message: e?.message || String(e) };
  }
}

async function runSql(query, params = []) {
  const mysql = await import('mysql2/promise');
  const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'massmail',
    waitForConnections: true,
    connectionLimit: 2,
  });
  try {
    const [rows] = await pool.query(query, params);
    return rows;
  } finally {
    await pool.end();
  }
}

async function runStatusCheck(targetPhoneFilter) {
  console.log('========== 发送情况检查 ==========\n');
  const dbResult = await checkDb();
  if (!dbResult.ok) {
    console.log(`[FAIL] DB: ${dbResult.message}`);
    process.exitCode = 1;
    return;
  }
  try {
    let rows;
    if (targetPhoneFilter) {
      const normalized = String(targetPhoneFilter).replace(/\D/g, '');
      const like = `%${normalized}%`;
      rows = await runSql(
        `SELECT id, target_phone, status, account_id, error_msg, created_at, updated_at
         FROM message_tasks WHERE REPLACE(target_phone, ' ', '') LIKE ? OR target_phone = ?
         ORDER BY id DESC LIMIT 25`,
        [like, targetPhoneFilter]
      );
      console.log(`目标号码: ${targetPhoneFilter}（共 ${rows?.length ?? 0} 条）\n`);
    } else {
      rows = await runSql(
        `SELECT id, target_phone, status, account_id, error_msg, created_at, updated_at
         FROM message_tasks ORDER BY id DESC LIMIT 15`
      );
      console.log('最近 15 条任务:\n');
    }
    if (!rows || rows.length === 0) {
      console.log('暂无记录。');
      console.log('\n========== 检查结束 ==========');
      return;
    }
    const statusMap = { Pending: '待处理', PENDING: '待处理', LOCKED: '已分配', Processing: '发送中', Sent: '已发送', Failed: '失败', Received: '接收' };
    console.log('ID\t目标号码\t\t状态\t\t账号\t创建时间\t\t更新时间\t\t错误信息');
    console.log('-'.repeat(120));
    for (const r of rows) {
      const status = statusMap[r.status] || r.status;
      const err = (r.error_msg || '').slice(0, 40);
      const created = r.created_at ? new Date(r.created_at).toLocaleString('zh-CN') : '-';
      const updated = r.updated_at ? new Date(r.updated_at).toLocaleString('zh-CN') : '-';
      console.log(`${r.id}\t${String(r.target_phone).slice(0, 14)}\t${status}\t\t${r.account_id ?? '-'}\t${created}\t${updated}\t${err}`);
    }
    console.log('\n========== 检查结束 ==========');
  } catch (e) {
    if (e?.code === 'ER_NO_SUCH_TABLE') {
      console.log('[!] 表 message_tasks 不存在，请先执行 schema。');
    } else {
      console.error(e?.message || e);
    }
    process.exitCode = 1;
  }
}

function proxyDisplayFromRow(r) {
  if (r.proxy_host) return (r.proxy_protocol || 'http') + '://' + r.proxy_host + ':' + (r.proxy_port || '');
  if (r.account_proxy_url) return r.account_proxy_url;
  return null;
}

async function runFailuresCheck(options = {}) {
  const debug = process.env.DEBUG === '1' || process.env.DEBUG === 'true';
  const filterByProxyUrl = options.proxyUrl ? String(options.proxyUrl).trim() : null;
  if (debug) console.log('[DEBUG] runFailuresCheck called', options, '\n');
  console.log('========== 失败原因检查 ==========\n');
  if (filterByProxyUrl) console.log('仅显示代理: ' + filterByProxyUrl + '\n');
  const dbResult = await checkDb();
  if (debug) console.log('[DEBUG] DB result:', { ok: dbResult.ok, message: dbResult.message });
  if (!dbResult.ok) {
    console.log(`[FAIL] DB: ${dbResult.message}`);
    process.exitCode = 1;
    return;
  }
  try {
    const limit = filterByProxyUrl ? 100 : 20;
    const rows = await runSql(
      `SELECT t.id, t.target_phone, t.status, t.account_id, t.error_msg, t.error_code, t.content, t.created_at, t.updated_at,
              a.username AS account_username, a.status AS account_status, a.error_msg AS account_error_msg, a.proxy_url AS account_proxy_url,
              px.host AS proxy_host, px.port AS proxy_port, px.protocol AS proxy_protocol
       FROM message_tasks t
       LEFT JOIN accounts a ON a.id = t.account_id
       LEFT JOIN account_proxy_bindings ap ON ap.account_id = t.account_id AND ap.is_active = 1
       LEFT JOIN proxies px ON px.id = ap.proxy_id AND px.is_active = 1
       WHERE t.status = 'Failed'
       ORDER BY t.updated_at DESC
       LIMIT ?`,
      [limit]
    );
    let list = rows || [];
    if (filterByProxyUrl && list.length > 0) {
      list = list.filter((r) => {
        const disp = proxyDisplayFromRow(r);
        return disp && (disp === filterByProxyUrl || disp.includes(filterByProxyUrl) || filterByProxyUrl.includes(disp));
      });
      list = list.slice(0, 20);
    }
    if (!list.length) {
      console.log(filterByProxyUrl ? `暂无使用该代理的失败任务。` : '暂无失败任务。');
      console.log('\n========== 检查结束 ==========');
      return;
    }
    console.log(`共 ${list.length} 条失败任务，按更新时间倒序：\n`);
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      const proxyDisp = proxyDisplayFromRow(r) || '未绑定代理';
      console.log('--- 失败任务 #' + (i + 1) + ' (id=' + r.id + ') ---');
      console.log('  目标号码: ' + (r.target_phone || '-'));
      console.log('  账号: id=' + (r.account_id ?? '-') + '  username=' + (r.account_username || '-') + '  账号状态=' + (r.account_status || '-'));
      console.log('  发送时连接 IP（代理）: ' + proxyDisp);
      console.log('  内容摘要: ' + (r.content ? String(r.content).slice(0, 60) + (r.content.length > 60 ? '...' : '') : '-'));
      console.log('  创建: ' + (r.created_at ? new Date(r.created_at).toLocaleString('zh-CN') : '-'));
      console.log('  更新: ' + (r.updated_at ? new Date(r.updated_at).toLocaleString('zh-CN') : '-'));
      console.log('  错误码: ' + (r.error_code || '-'));
      console.log('  失败原因（完整）: ' + (r.error_msg || '(无)'));
      if (r.account_error_msg) console.log('  账号侧错误: ' + r.account_error_msg);
      console.log('');
    }
    console.log('========== 检查结束 ==========');
    console.log('\n若为 Login failed / 登录失败，请到「账号管理」更新该账号密码或重新探测。');
    console.log('若为代理/网络超时，请检查「IP 配置」中代理可用性。');
  } catch (e) {
    if (e?.code === 'ER_NO_SUCH_TABLE') {
      console.log('[!] 表 message_tasks 或 accounts 不存在，请先执行 schema。');
    } else {
      console.error(e?.message || e);
    }
    process.exitCode = 1;
  }
}

async function main() {
  await loadEnv();

  const args = process.argv.slice(2);
  const createTest = args.includes('--create-test');
  const targetPhone = args[args.indexOf('--create-test') + 1] || '1000000000';
  const statusOnly = args.includes('--status');
  const statusPhone = statusOnly ? (args[args.indexOf('--status') + 1] || null) : null;
  const failuresOnly = args.includes('--failures');
  const failuresByIpIdx = args.indexOf('--failures-by-ip');
  const failuresByIp = failuresByIpIdx >= 0 ? (args[failuresByIpIdx + 1] || '').trim() : null;
  const debug = process.env.DEBUG === '1' || process.env.DEBUG === 'true';

  if (failuresOnly || failuresByIpIdx >= 0) {
    if (debug) console.log('[DEBUG] argv:', process.argv.slice(2));
    await runFailuresCheck(failuresByIp ? { proxyUrl: failuresByIp } : {});
    return;
  }
  if (statusOnly) {
    await runStatusCheck(statusPhone);
    return;
  }

  console.log('========== 发信打通检查 ==========\n');

  const redisResult = await checkRedis();
  console.log(redisResult.ok ? `[OK] ${redisResult.message}` : `[FAIL] Redis: ${redisResult.message}`);
  if (!redisResult.ok) {
    console.log('\n请先启动 Redis，Worker 与调度器依赖 Redis 队列与锁。');
    process.exitCode = 1;
  }

  const dbResult = await checkDb();
  console.log(dbResult.ok ? `[OK] ${dbResult.message}` : `[FAIL] DB: ${dbResult.message}`);
  if (!dbResult.ok) {
    console.log('\n请检查 DB_HOST/DB_USER/DB_PASSWORD/DB_NAME。');
    process.exitCode = 1;
  }

  if (!dbResult.ok) {
    console.log('\n跳过后续 SQL 检查。');
    return;
  }

  let readyCount = 0, withProxyCount = 0, readyWithProxy = 0, pendingCount = 0, recentFailed = [];
  try {
    readyCount = await runSql(
      "SELECT COUNT(*) AS c FROM accounts WHERE status = 'Ready'"
    ).then((r) => r[0]?.c ?? 0);
    withProxyCount = await runSql(
      `SELECT COUNT(DISTINCT ap.account_id) AS c
       FROM account_proxy_bindings ap
       INNER JOIN proxies p ON p.id = ap.proxy_id AND p.is_active = 1
       WHERE ap.is_active = 1`
    ).then((r) => r[0]?.c ?? 0);
    readyWithProxy = await runSql(
      `SELECT COUNT(DISTINCT a.id) AS c
       FROM accounts a
       INNER JOIN account_proxy_bindings ap ON ap.account_id = a.id AND ap.is_active = 1
       INNER JOIN proxies p ON p.id = ap.proxy_id AND p.is_active = 1
       WHERE a.status = 'Ready'`
    ).then((r) => r[0]?.c ?? 0);
    pendingCount = await runSql(
      "SELECT COUNT(*) AS c FROM message_tasks WHERE status IN ('Pending','PENDING')"
    ).then((r) => r[0]?.c ?? 0);
    recentFailed = await runSql(
      `SELECT id, target_phone, status, error_msg, updated_at
       FROM message_tasks WHERE status = 'Failed' ORDER BY updated_at DESC LIMIT 3`
    );
  } catch (e) {
    if (e?.code === 'ER_NO_SUCH_TABLE') {
      console.log('\n[!] 数据库表不存在或未初始化，请先在服务器执行 schema（如 backend/scripts/schema_full_create.sql 或应用启动时的建表逻辑）。');
      console.log('========== 检查结束 ==========');
      return;
    }
    throw e;
  }

  console.log(`\n--- 发信链路 ---`);
  console.log(`Ready 账号数: ${readyCount}`);
  console.log(`有代理绑定的账号数: ${withProxyCount}`);
  console.log(`Ready 且带代理（可发信）: ${readyWithProxy}`);
  console.log(`当前 Pending 任务数: ${pendingCount}`);

  if (readyWithProxy === 0) {
    console.log('\n[!] 没有「Ready 且带代理」的账号，调度器不会派发任务。请在「账号管理」中确认账号状态为 Ready，并在「IP 配置」中为账号绑定代理。');
    process.exitCode = 1;
  }
  if (pendingCount > 0 && readyWithProxy > 0) {
    console.log('\n[?] 有 Pending 任务且有可发信账号。若任务一直不执行，请确认: 1) 已启动 massmail-worker  2) Redis 正常  3) 时间熵未把任务排到未来（可查 message_tasks.scheduled_at）。');
  }

  if (recentFailed.length > 0) {
    console.log('\n--- 最近 3 条失败任务 ---');
    recentFailed.forEach((t) => {
      console.log(`  id=${t.id} target=${t.target_phone} error=${(t.error_msg || '').slice(0, 80)}`);
    });
  }

  if (createTest) {
    console.log(`\n--- 插入测试任务并轮询 (target=${targetPhone}, 90s) ---`);
    const tenantId = 1;
    let accountId = null;
    const accRows = await runSql(
      `SELECT a.id FROM accounts a
       INNER JOIN account_proxy_bindings ap ON ap.account_id = a.id AND ap.is_active = 1
       INNER JOIN proxies p ON p.id = ap.proxy_id AND p.is_active = 1
       WHERE a.status = 'Ready' AND a.tenant_id = ? LIMIT 1`,
      [tenantId]
    );
    if (accRows.length > 0) {
      accountId = accRows[0].id;
    } else {
      const subRows = await runSql(
        `SELECT s.id FROM sub_accounts s
         WHERE s.tenant_id = ? AND s.status = 'ready' AND s.enabled = 1 AND s.proxy_id IS NOT NULL
         ORDER BY s.weight DESC, s.id ASC LIMIT 1`,
        [tenantId]
      );
      if (subRows.length > 0) {
        console.log('[INFO] 无 Ready+代理 账号；使用子账号调度，插入 account_id=NULL，调度器将自动分配 sub_account。');
      } else {
        console.log('[FAIL] 无 Ready+代理 账号，且无可用于调度的子账号（ready + enabled + proxy_id），无法插入测试任务。');
        process.exitCode = 1;
        return;
      }
    }
    const mysql = await import('mysql2/promise');
    const insertPool = mysql.createPool({
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT) || 3306,
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'massmail',
      waitForConnections: true,
      connectionLimit: 2,
    });
    const [insertResult] = await insertPool.query(
      `INSERT INTO message_tasks (account_id, target_phone, content, status, tenant_id, created_at)
       VALUES (?, ?, ?, 'Pending', ?, NOW())`,
      [accountId, targetPhone, '[发信打通测试]', tenantId]
    );
    await insertPool.end();
    const taskId = insertResult?.insertId;
    if (!taskId) {
      console.log('[FAIL] 插入任务失败');
      process.exitCode = 1;
      return;
    }
    console.log(`已插入任务 id=${taskId}，等待调度与 Worker 处理...`);
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 3000));
      const tasks = await runSql('SELECT id, status, error_msg FROM message_tasks WHERE id = ?', [taskId]);
      const t = Array.isArray(tasks) ? tasks[0] : tasks;
      if (!t) break;
      console.log(`  [${new Date().toISOString()}] task ${taskId} status=${t.status} ${t.error_msg ? `error=${String(t.error_msg).slice(0, 60)}` : ''}`);
      if (t.status === 'Sent' || t.status === 'Success') {
        console.log('\n[OK] 测试任务已发送，发信链路打通。');
        return;
      }
      if (t.status === 'Failed') {
        console.log('\n[FAIL] 测试任务失败，请查看 error_msg 与 pm2 logs massmail-worker。');
        process.exitCode = 1;
        return;
      }
    }
    console.log('\n[?] 90 秒内任务未完成，请检查 Worker 是否运行: pm2 list / pm2 logs massmail-worker。');
    process.exitCode = 1;
  }

  console.log('\n========== 检查结束 ==========');
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
