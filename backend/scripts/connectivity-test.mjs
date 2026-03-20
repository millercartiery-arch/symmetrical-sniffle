#!/usr/bin/env node
/**
 * 联通测试：只测 API 是否可达（不连数据库）
 * 用法:
 *   node backend/scripts/connectivity-test.mjs
 *   node backend/scripts/connectivity-test.mjs https://hkd.llc/api
 *   API_BASE=http://127.0.0.1:3000 node backend/scripts/connectivity-test.mjs
 */
const API_BASE = process.env.API_BASE || process.argv[2] || 'https://hkd.llc/api';
const base = API_BASE.replace(/\/+$/, '');
const healthUrl = base.includes('/api') ? `${base}/health` : `${base}/api/health`;

async function test() {
  const start = Date.now();
  try {
    const res = await fetch(healthUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
    const ms = Date.now() - start;
    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = {};
    }
    if (res.ok && (body?.ok === true || body?.ok === 'true')) {
      console.log(`[OK] ${healthUrl} -> ${res.status} (${ms}ms)`);
      process.exit(0);
    }
    console.error(`[FAIL] ${healthUrl} -> ${res.status} (${ms}ms) body: ${text.slice(0, 200)}`);
    process.exit(1);
  } catch (e) {
    const ms = Date.now() - start;
    console.error(`[FAIL] ${healthUrl} -> ${e.message || e} (${ms}ms)`);
    process.exit(1);
  }
}

test();
