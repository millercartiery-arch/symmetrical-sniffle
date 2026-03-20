#!/usr/bin/env node
/**
 * 全局代理健康探测（更新 last_checked_at / last_alive / last_latency_ms / last_error_msg）。
 * 可独立于 API 运行，供 cron 或 full-run-check 使用。
 * 用法：node scripts/proxy-check.mjs
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

await loadEnv();

const mysql = await import('mysql2/promise');
const axios = (await import('axios')).default;
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'massmail',
  connectionLimit: 5,
});

const PROBE_URL = process.env.PROXY_PROBE_URL || 'https://ipapi.co/json/';
const TIMEOUT_MS = Number(process.env.PROXY_PROBE_TIMEOUT_MS) || 10000;

async function probe(proxyUrl) {
  const start = Date.now();
  try {
    const HttpsProxyAgent = (await import('https-proxy-agent')).HttpsProxyAgent;
    const agent = new HttpsProxyAgent(proxyUrl);
    const res = await axios.get(PROBE_URL, {
      httpsAgent: agent,
      timeout: TIMEOUT_MS,
      validateStatus: () => true,
      headers: { 'User-Agent': 'massmail-proxy-check/1.0' },
    });
    const latencyMs = Date.now() - start;
    const ok = res.status >= 200 && res.status < 400;
    return { ok, latencyMs, error: ok ? null : `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, latencyMs: Date.now() - start, error: e?.message || 'Connection failed' };
  }
}

function buildProxyUrl(row) {
  const protocol = (row.protocol || 'http').trim();
  const user = row.username;
  let pass = row.password;
  if ((!pass || pass === '') && row.auth_pass_enc) {
    try {
      const crypto = await import('crypto');
      const keyB64 = process.env.PROXY_ENC_KEY?.trim();
      let key = Buffer.alloc(32);
      if (keyB64) {
        key = Buffer.from(keyB64, 'base64').subarray(0, 32);
      } else {
        const raw = process.env.MSG_ENC_KEY || '12345678901234567890123456789012';
        key = raw.length === 32 ? Buffer.from(raw) : crypto.createHash('sha256').update(raw).digest();
      }
      const buf = Buffer.from(row.auth_pass_enc, 'base64');
      if (buf.length >= 28) {
        const iv = buf.subarray(0, 12);
        const tag = buf.subarray(12, 28);
        const enc = buf.subarray(28);
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(tag);
        pass = Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
      }
    } catch (_) {
      pass = '';
    }
  }
  const auth = user ? `${encodeURIComponent(user)}:${encodeURIComponent(pass || '')}@` : '';
  return `${protocol}://${auth}${row.host}:${row.port}`;
}

async function main() {
  const [rows] = await pool.query(
    `SELECT id, protocol, host, port, username, password, auth_pass_enc FROM proxies WHERE is_active = 1`
  );
  if (!rows?.length) {
    console.log('无启用代理，跳过探测。');
    await pool.end();
    return;
  }
  console.log(`探测 ${rows.length} 个代理…`);
  for (const row of rows) {
    const url = buildProxyUrl(row);
    const result = await probe(url);
    const errMsg = result.error ? String(result.error).slice(0, 500) : null;
    await pool.query(
      `UPDATE proxies SET last_checked_at = NOW(), last_alive = ?, last_latency_ms = ?, last_error_msg = ? WHERE id = ?`,
      [result.ok ? 1 : 0, result.latencyMs, errMsg, row.id]
    );
    console.log(`  id=${row.id} ${result.ok ? 'OK' : 'FAIL'} ${result.latencyMs}ms ${result.error || ''}`);
  }
  await pool.end();
  console.log('代理探测完成。');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
