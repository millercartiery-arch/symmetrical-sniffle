#!/usr/bin/env node
/**
 * TN 真实发送测试：从桌面 50.txt 取 10 个账号导入 → 绑定代理 → 按生产顺序入队 5 条（2 文本 + 3 图片）→ 轮询完成后汇报。
 * 对方号码与文本内容已内置；图片任务使用环境变量 TEST_IMAGE_URL（可选）。
 * 运行前：Redis + MySQL 已启动，至少 1 个代理已配置且 is_active=1，然后启动 worker：npm run start:worker
 * 执行：tsx scripts/run-tn-test-send.ts
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { pool } from '../src/shared/db.js';
import { encrypt } from '../src/shared/crypto.js';
import { normalizeImportAccount, getMissingRequiredFields } from '../src/shared/import-normalizer.js';

const DESKTOP_50 = process.env.TN_50_FILE || path.join(process.env.USERPROFILE || process.env.HOME || '', 'OneDrive', 'Desktop', '50.txt');
const TARGET_PHONES = [
  '12532987484',
  '14133860003',
  '14352193204',
  '12512540467',
  '18707381711',
  '13145177607',
  '18592278302',
  '14074704323',
  '18653566663',
  '18166898146',
];
const TEXT_MESSAGES = [
  "What are you up to these days?",
  "What's been keeping you busy lately?",
  "What's your favorite way to relax?",
  "What's the best book you've read recently?",
  "What's one thing you want to achieve this year?",
  "What's something you've always wanted to learn?",
  "What kind of music are you listening to now?",
  "What's your favorite movie genre?",
  "What's the most exciting trip you've taken?",
  "What's the last thing that made you laugh out loud?",
  "What's your favorite hobby these days?",
];
const IMAGE_URL = process.env.TEST_IMAGE_URL || 'https://picsum.photos/400/300';
const TENANT_ID = 1;
const POLL_INTERVAL_MS = 3000;
const POLL_DEADLINE_MS = 120000;

async function loadAccounts(count: number): Promise<any[]> {
  const raw = fs.readFileSync(DESKTOP_50, 'utf8');
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  const out: any[] = [];
  for (let i = 0; i < Math.min(count, lines.length); i++) {
    try {
      out.push(JSON.parse(lines[i]));
    } catch {
      // skip invalid line
    }
  }
  return out;
}

async function importAccounts(conn: any, accounts: any[]): Promise<number[]> {
  const ids: number[] = [];
  for (const raw of accounts) {
    const acc = normalizeImportAccount(raw);
    const missing = getMissingRequiredFields(acc);
    if (missing.length) continue;
    const tokenBuf = encrypt(acc.token);
    const [rows]: any = await conn.query(
      `INSERT INTO accounts (
        phone, email, username, password, status, system_type, proxy_url,
        tn_client_id, tn_device_model, tn_os_version, tn_user_agent, tn_uuid, tn_vid,
        signature, app_version, brand, language, fp, tn_session_id, tn_session_token_cipher,
        tenant_id, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
      ON DUPLICATE KEY UPDATE
        email = VALUES(email), username = VALUES(username), password = VALUES(password),
        status = VALUES(status), system_type = VALUES(system_type), tn_client_id = VALUES(tn_client_id),
        tn_device_model = VALUES(tn_device_model), tn_os_version = VALUES(tn_os_version),
        tn_user_agent = VALUES(tn_user_agent), tn_uuid = VALUES(tn_uuid), tn_vid = VALUES(tn_vid),
        signature = VALUES(signature), app_version = VALUES(app_version), brand = VALUES(brand),
        language = VALUES(language), fp = VALUES(fp), tn_session_id = VALUES(tn_session_id),
        tn_session_token_cipher = VALUES(tn_session_token_cipher), updated_at = NOW()`,
      [
        acc.phone || null, acc.email || null, acc.username || null, acc.password || '123456', acc.status || 'Ready',
        acc.platform || 'iOS', acc.proxyUrl || null, acc.clientId || null, acc.model || null, acc.osVersion || null,
        acc.userAgent || null, acc.uuid || null, acc.vid || null, acc.signature || null, acc.appVersion || null,
        acc.brand || null, acc.language || null, acc.fp || null, acc.sessionId || null, tokenBuf,
        TENANT_ID,
      ]
    );
    const id = rows?.insertId;
    if (id) ids.push(id);
    else {
      const [r2]: any = await conn.query('SELECT id FROM accounts WHERE phone = ? LIMIT 1', [acc.phone]);
      if (r2?.length) ids.push(r2[0].id);
    }
  }
  return ids;
}

async function bindAccountsToProxy(conn: any, accountIds: number[], proxyId: number): Promise<void> {
  for (let i = 0; i < accountIds.length; i++) {
    await conn.query(
      `INSERT INTO account_proxy_bindings (account_id, proxy_id, session_key, is_primary, is_active)
       VALUES (?, ?, ?, 1, 1)
       ON DUPLICATE KEY UPDATE session_key = VALUES(session_key), is_active = 1`,
      [accountIds[i], proxyId, `acc-${accountIds[i]}`]
    );
  }
}

async function createTasks(conn: any): Promise<number[]> {
  const taskIds: number[] = [];
  const tasks: { target_phone: string; content: string | null; media_url: string | null; message_type: string }[] = [
    { target_phone: TARGET_PHONES[0], content: TEXT_MESSAGES[0], media_url: null, message_type: 'text' },
    { target_phone: TARGET_PHONES[1], content: TEXT_MESSAGES[1], media_url: null, message_type: 'text' },
    { target_phone: TARGET_PHONES[2], content: null, media_url: IMAGE_URL, message_type: 'image' },
    { target_phone: TARGET_PHONES[3], content: null, media_url: IMAGE_URL, message_type: 'image' },
    { target_phone: TARGET_PHONES[4], content: null, media_url: IMAGE_URL, message_type: 'image' },
  ];
  for (const t of tasks) {
    const [res]: any = await conn.query(
      `INSERT INTO message_tasks (account_id, target_phone, content, media_url, message_type, status, tenant_id, created_at)
       VALUES (NULL, ?, ?, ?, ?, 'Pending', ?, NOW())`,
      [t.target_phone, t.content || '', t.media_url, t.message_type, TENANT_ID]
    );
    taskIds.push(res.insertId);
  }
  return taskIds;
}

async function pollUntilDone(taskIds: number[]): Promise<Map<number, string>> {
  const statusByTask = new Map<number, string>();
  const deadline = Date.now() + POLL_DEADLINE_MS;
  while (Date.now() < deadline) {
    const [rows]: any = await pool.query(
      'SELECT id, status FROM message_tasks WHERE id IN (?)',
      [taskIds]
    );
    for (const r of rows || []) statusByTask.set(r.id, r.status);
    const statuses = [...statusByTask.values()];
    const done = statuses.every((s) => s === 'Sent' || s === 'Failed');
    if (done) break;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  return statusByTask;
}

async function main() {
  if (!fs.existsSync(DESKTOP_50)) {
    console.error('❌ 未找到 50 账号文件:', DESKTOP_50);
    process.exit(1);
  }
  const conn = await pool.getConnection();
  let taskIds: number[] = [];
  try {
    const rawAccounts = await loadAccounts(10);
    if (rawAccounts.length < 10) {
      console.warn('⚠️ 仅解析到', rawAccounts.length, '个账号，继续执行');
    }
    const accountIds = await importAccounts(conn, rawAccounts);
    console.log('✅ 已导入/更新账号数:', accountIds.length);

    const [proxies]: any = await conn.query('SELECT id FROM proxies WHERE is_active = 1 LIMIT 1');
    if (!proxies?.length) {
      console.error('❌ 无可用代理，请先在「IP 配置」添加并启用至少 1 个代理');
      process.exit(1);
    }
    const proxyId = proxies[0].id;
    await bindAccountsToProxy(conn, accountIds, proxyId);
    console.log('✅ 已绑定代理 proxy_id=', proxyId);

    await conn.query("UPDATE accounts SET status = 'Ready' WHERE id IN (?)", [accountIds]);
    taskIds = await createTasks(conn);
    console.log('✅ 已入队 5 条任务（2 文本 + 3 图片）:', taskIds.join(', '));
    console.log('⏳ 等待调度与 Worker 处理（约 2 分钟）…');
  } finally {
    conn.release();
  }

  const statusByTask = await pollUntilDone(taskIds);
  console.log('\n========== 发送结果 ==========');
  console.log('【2 次文本】');
  taskIds.slice(0, 2).forEach((id, i) => {
    console.log(`  ${i + 1}. 任务 id=${id} 状态=${statusByTask.get(id) || '?'}  → ${TARGET_PHONES[i]}`);
  });
  console.log('【3 次图片】');
  taskIds.slice(2, 5).forEach((id, i) => {
    console.log(`  ${i + 1}. 任务 id=${id} 状态=${statusByTask.get(id) || '?'}  → ${TARGET_PHONES[2 + i]}`);
  });
  console.log('========== 结束 ==========');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
