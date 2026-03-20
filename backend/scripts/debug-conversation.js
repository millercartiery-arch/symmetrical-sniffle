#!/usr/bin/env node
/**
 * Ⅳ 端到端排查脚本：列表第 N 条 → 对应 DB 记录 → 详情接口返回
 * 本项目无 GET /api/conversations/:id，列表为 GET /user/chat/conversations，详情为 GET /user/chat/messages?peerPhone=xxx
 *
 * 使用：在 .env 中设置 ADMIN_TOKEN（管理员 JWT），可选 API_BASE_URL、SERVER_PORT、TENANT_ID、DB_*
 *   node scripts/debug-conversation.js [limit] [index]
 * 例：node scripts/debug-conversation.js 20 1   # 列表 limit=20，取第 1 条
 */
import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import mysql from 'mysql2/promise';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, '..', '.env') });

const API_BASE = (process.env.API_BASE_URL || `http://127.0.0.1:${process.env.SERVER_PORT || 3000}`).replace(/\/+$/, '');
const TOKEN = process.env.ADMIN_TOKEN;
const LIMIT = Number(process.argv[2] || 20);
const IDX = Number(process.argv[3] || 1); // 列表中第几条（从 1 开始）
const TENANT_ID = Number(process.env.TENANT_ID || 1);

if (!TOKEN) {
  console.error('⚠ 请在 .env 中设置 ADMIN_TOKEN（管理员 JWT）');
  process.exit(1);
}

async function runSql(query, params = []) {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: +(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'massmail',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'massmail',
  });
  const [rows] = await pool.execute(query, params);
  await pool.end();
  return rows;
}

(async () => {
  const base = API_BASE + (API_BASE.endsWith('/api') ? '' : '/api');

  // 1️⃣ 拉取会话列表（本项目：按 phone 聚合，无 conversation id）
  let listRes;
  try {
    listRes = await axios.get(`${base}/user/chat/conversations`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
      params: { limit: LIMIT },
    });
  } catch (e) {
    console.error('❌ 列表接口错误：', e.response?.status, e.response?.data || e.message);
    process.exit(1);
  }

  const list = Array.isArray(listRes.data?.data) ? listRes.data.data : listRes.data?.list || [];
  if (list.length === 0) {
    console.error('⚠ 列表为空，请检查 limit 或权限/租户');
    process.exit(1);
  }

  const item = list[IDX - 1];
  if (!item) {
    console.error('⚠ 第', IDX, '条不存在，当前列表长度', list.length);
    process.exit(1);
  }

  const peerPhone = item.phone || item.peerPhone || item.target_phone;
  console.log('🔎 选中的列表项（第', IDX, '条）:', item);
  console.log('   → 用于详情的 peerPhone:', peerPhone);

  // 2️⃣ 直接查 DB：该会话（target_phone + tenant_id）下的任务
  const rows = await runSql(
    'SELECT id, target_phone, account_id, status, error_msg, created_at FROM message_tasks WHERE target_phone = ? AND tenant_id = ? ORDER BY created_at DESC LIMIT 5',
    [peerPhone, TENANT_ID]
  );
  console.log('🗄 DB 中该会话最近 5 条 message_tasks：', rows.length ? rows : '(无)');
  if (rows[0]) console.log('   （首条 task id）:', rows[0].id);

  // 3️⃣ 调用详情接口（本项目：GET /user/chat/messages?peerPhone=xxx）
  try {
    const detailRes = await axios.get(`${base}/user/chat/messages`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
      params: { peerPhone, limit: 50 },
    });
    console.log('📡 API 详情响应（200）:', Array.isArray(detailRes.data?.data) ? `${detailRes.data.data.length} 条消息` : detailRes.data);
  } catch (e) {
    console.error('❌ API 详情错误：', e.response?.status, e.response?.data || e.message);
  }

  // 4️⃣ 帮助定位：打印实际查询条件
  console.log('🧾 详情接口等价 SQL（WHERE target_phone=? AND tenant_id=?）：');
  console.log('   peerPhone =', peerPhone, ', tenant_id =', TENANT_ID);
})();
