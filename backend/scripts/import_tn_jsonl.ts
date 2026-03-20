#!/usr/bin/env node
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { pool } from '../src/shared/db.js';
import { encrypt } from '../src/shared/crypto.js';
import { getMissingRequiredFields, normalizeImportAccount } from '../src/shared/import-normalizer.js';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const limitIndex = args.indexOf('--limit');
const limit = limitIndex >= 0 ? Number(args[limitIndex + 1]) || Infinity : Infinity;
const fileArg = args.find(arg => !arg.startsWith('--') && arg !== String(limit));
const filePath = fileArg || process.env.TN_IMPORT_FILE || path.join(process.env.USERPROFILE || process.env.HOME || '', 'Downloads', 'Telegram Desktop', '50 (3).txt');
const tenantId = Number(process.env.TN_IMPORT_TENANT_ID || 1);

type ImportStats = {
  imported: number;
  updated: number;
  failed: number;
  skipped: number;
};

function loadJsonLines(target: string): any[] {
  const raw = fs.readFileSync(target, 'utf8');
  return raw
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .slice(0, Number.isFinite(limit) ? limit : undefined)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch {
        throw new Error(`Invalid JSON on line ${index + 1}`);
      }
    });
}

async function upsertAccount(conn: any, row: any, stats: ImportStats, index: number) {
  const acc = normalizeImportAccount(row);
  const missing = getMissingRequiredFields(acc);
  if (missing.length) {
    stats.skipped++;
    console.warn(`[skip] line ${index + 1}: missing ${missing.join(', ')}`);
    return;
  }

  const [existingRows]: any = await conn.execute(
    'SELECT id FROM accounts WHERE phone = ? AND tenant_id = ? LIMIT 1',
    [acc.phone, tenantId]
  );
  const existingId = existingRows?.[0]?.id ? Number(existingRows[0].id) : null;

  if (dryRun) {
    if (existingId) stats.updated++;
    else stats.imported++;
    return;
  }

  const tokenBuf = encrypt(acc.token);

  if (existingId) {
    await conn.execute(
      `UPDATE accounts
       SET email = ?, username = ?, password = ?, status = ?, system_type = ?, proxy_url = ?,
           tn_client_id = ?, tn_device_model = ?, tn_os = ?, tn_os_version = ?, tn_user_agent = ?,
           tn_uuid = ?, tn_vid = ?, signature = ?, app_version = ?, brand = ?, language = ?,
           fp = ?, tn_session_id = ?, tn_session_token_cipher = ?, updated_at = NOW()
       WHERE id = ? AND tenant_id = ?`,
      [
        acc.email || null,
        acc.username || null,
        acc.password || '123456',
        acc.status || 'Ready',
        acc.platform || 'iOS',
        acc.proxyUrl || null,
        acc.clientId || null,
        acc.model || null,
        acc.platform || null,
        acc.osVersion || null,
        acc.userAgent || null,
        acc.uuid || null,
        acc.vid || null,
        acc.signature || null,
        acc.appVersion || null,
        acc.brand || null,
        acc.language || null,
        acc.fp || null,
        acc.sessionId || null,
        tokenBuf,
        existingId,
        tenantId
      ]
    );
    stats.updated++;
    return;
  }

  await conn.execute(
    `INSERT INTO accounts (
      phone, email, username, password, status, system_type, proxy_url,
      tn_client_id, tn_device_model, tn_os, tn_os_version, tn_user_agent,
      tn_uuid, tn_vid, signature, app_version, brand, language, fp,
      tn_session_id, tn_session_token_cipher, tenant_id, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
    [
      acc.phone || null,
      acc.email || null,
      acc.username || null,
      acc.password || '123456',
      acc.status || 'Ready',
      acc.platform || 'iOS',
      acc.proxyUrl || null,
      acc.clientId || null,
      acc.model || null,
      acc.platform || null,
      acc.osVersion || null,
      acc.userAgent || null,
      acc.uuid || null,
      acc.vid || null,
      acc.signature || null,
      acc.appVersion || null,
      acc.brand || null,
      acc.language || null,
      acc.fp || null,
      acc.sessionId || null,
      tokenBuf,
      tenantId
    ]
  );
  stats.imported++;
}

async function main() {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const rows = loadJsonLines(filePath);
  const stats: ImportStats = { imported: 0, updated: 0, failed: 0, skipped: 0 };
  const conn = await pool.getConnection();

  try {
    for (let i = 0; i < rows.length; i += 1) {
      try {
        await upsertAccount(conn, rows[i], stats, i);
      } catch (error: any) {
        stats.failed++;
        console.error(`[fail] line ${i + 1}:`, error?.message || error);
      }
    }
  } finally {
    conn.release();
  }

  console.log(JSON.stringify({
    filePath,
    tenantId,
    dryRun,
    total: rows.length,
    ...stats
  }, null, 2));
}

main().catch(error => {
  console.error(error?.message || error);
  process.exit(1);
});
