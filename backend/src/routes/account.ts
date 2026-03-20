
import express from 'express';
import { pool } from '../shared/db.js';
import { encrypt } from '../shared/crypto.js';
import { getMissingRequiredFields, normalizeImportAccount } from '../shared/import-normalizer.js';
import Redis from 'ioredis';

const router = express.Router();
const pubRedis = new (Redis as any)(process.env.REDIS_URL || 'redis://localhost:6379');

const toTrimmed = (v: unknown): string => String(v ?? '').trim();
const nullable = (v: unknown): string | null => {
    const s = toTrimmed(v);
    return s ? s : null;
};
const hasRichImportFields = (row: Record<string, unknown>) => {
    return [
        row.phone,
        row.email,
        row.clientId,
        row.token,
        row.cookie,
        row.Cookie,
        row['X-PX-AUTHORIZATION'],
        row['x-px-authorization'],
    ].some((value) => nullable(value) !== null);
};

let subAccountSchemaReady = false;
const ensureSubAccountSchema = async () => {
    if (subAccountSchemaReady) return;
    const conn = await pool.getConnection();
    try {
        const userAlters = [
            "ALTER TABLE users ADD COLUMN quota_limit INT DEFAULT 10 NOT NULL",
            "ALTER TABLE users ADD COLUMN api_key VARCHAR(255) NULL",
            "ALTER TABLE users ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP",
        ];
        for (const sql of userAlters) {
            try { await conn.query(sql); } catch (err: any) { if (err?.code !== 'ER_DUP_FIELDNAME') throw err; }
        }
        const accountAlters = [
            "ALTER TABLE accounts ADD COLUMN tn_os VARCHAR(64) NULL",
            "ALTER TABLE accounts ADD COLUMN tn_type VARCHAR(64) NULL",
        ];
        for (const sql of accountAlters) {
            try { await conn.query(sql); } catch (err: any) { if (err?.code !== 'ER_DUP_FIELDNAME') throw err; }
        }
        subAccountSchemaReady = true;
    } finally {
        conn.release();
    }
};

// 仅保留一套账号列表：GET /accounts。?format=tn 时返回 TN 全量列表（含 sent_count 等），否则分页列表
router.get('/accounts', async (req, res) => {
    const formatTn = (req.query.format as string) === 'tn';
    await ensureSubAccountSchema();
    const conn = await pool.getConnection();
    try {
        const status = req.query.status as string;
        const search = req.query.search as string;
        let whereClause = 'WHERE 1=1';
        const queryParams: any[] = [];
        if (status) {
            whereClause += ' AND status = ?';
            queryParams.push(status);
        }
        if (search) {
            whereClause += ' AND phone LIKE ?';
            queryParams.push(`%${search}%`);
        }

        if (formatTn) {
            const [rows]: any = await conn.execute(
                `SELECT 
         id, phone, email, username, status, system_type, proxy_url, last_used_at,
         tn_session_id, tn_client_id, tn_device_model, tn_os, tn_os_version, tn_user_agent,
         tn_type, tn_uuid, tn_vid, app_version, brand, language,
         (SELECT COUNT(*) FROM message_tasks m WHERE m.account_id = accounts.id AND m.status = 'Sent') as sent_count,
         (SELECT COUNT(*) FROM message_tasks m WHERE m.account_id = accounts.id AND m.status = 'Received') as received_count,
         (SELECT COUNT(*) FROM message_tasks m WHERE m.account_id = accounts.id AND m.status = 'Sent' AND m.created_at >= CURDATE()) as today_sent,
         25 as daily_limit,
         CASE WHEN status = 'Cooldown' THEN DATE_ADD(updated_at, INTERVAL 24 HOUR) ELSE NULL END as cooldown_end,
         CASE WHEN tn_session_id IS NOT NULL AND tn_session_token_cipher IS NOT NULL THEN 1 ELSE 0 END AS tn_ready
       FROM accounts ${whereClause}
       ORDER BY updated_at DESC`,
                queryParams
            );
            return res.json({ items: rows });
        }

        const page = Math.max(1, parseInt(req.query.page as string) || 1);
        const limit = Math.max(1, Math.min(100, parseInt(req.query.limit as string) || 20));
        const offset = (page - 1) * limit;
        const [countRows]: any = await conn.execute(
            `SELECT COUNT(*) as total FROM accounts ${whereClause}`,
            queryParams
        );
        const total = countRows[0].total;
        const [rows]: any = await conn.query(
            `SELECT id, phone, email, username, status, system_type, proxy_url, last_used_at, updated_at,
             CASE WHEN tn_session_id IS NOT NULL THEN 1 ELSE 0 END as tn_ready
             FROM accounts ${whereClause}
             ORDER BY updated_at DESC
             LIMIT ${limit} OFFSET ${offset}`,
            queryParams
        );
        res.json({
            items: rows,
            pagination: { total, page, limit, totalPages: Math.ceil(total / limit) }
        });
    } catch (err: any) {
        res.status(500).json({ error: 'Failed to fetch accounts', detail: String(err?.message || err) });
    } finally {
        conn.release();
    }
});

// Sub-accounts 与卡密激活已迁移至 card-credential 路由：GET/POST /api/sub-accounts, POST /api/card/activate

router.delete('/accounts/:id', async (req, res) => {
    const conn = await pool.getConnection();
    try {
        const [result]: any = await conn.execute(
            'DELETE FROM accounts WHERE id = ?',
            [req.params.id]
        );
        res.json({ deleted: result.affectedRows });
    } catch (err: any) {
        res.status(500).json({ error: 'Failed to delete account', detail: String(err?.message || err) });
    } finally {
        conn.release();
    }
});

// Get all account IDs for global selection (TC-15)
router.get('/accounts/ids', async (req, res) => {
    const conn = await pool.getConnection();
    try {
        const status = req.query.status as string;
        const search = req.query.search as string;

        let whereClause = 'WHERE 1=1';
        const queryParams: any[] = [];

        if (status) {
            whereClause += ' AND status = ?';
            queryParams.push(status);
        }
        if (search) {
            whereClause += ' AND phone LIKE ?';
            queryParams.push(`%${search}%`);
        }

        const [rows]: any = await conn.execute(
            `SELECT id FROM accounts ${whereClause}`,
            queryParams
        );

        res.json({ ids: rows.map((r: any) => r.id) });
    } catch (err: any) {
        res.status(500).json({ error: 'Failed to fetch account IDs', detail: String(err?.message || err) });
    } finally {
        conn.release();
    }
});

// Audit Log API (TC-22)
router.post('/audit/log', async (req, res) => {
    const { action, details } = req.body;
    const user = req.headers['x-user-id'] || 'system';
    const tenantId = Number((req as any).tenantId ?? 1);

    const conn = await pool.getConnection();
    try {
        await conn.execute(
            'INSERT INTO audit_logs (user_id, action, details, tenant_id) VALUES (?, ?, ?, ?)',
            [user, action, JSON.stringify(details), tenantId]
        );
        res.json({ success: true });
    } catch (err: any) {
        console.error('Audit log failed:', err);
        res.status(500).json({ error: 'Log failed' });
    } finally {
        conn.release();
    }
});

// Lock/Unlock endpoints (TC-17)
router.post('/accounts/:id/lock', async (req, res) => {
    const conn = await pool.getConnection();
    try {
        const { id } = req.params;
        const user = req.headers['x-user-id'] || 'system';

        // Check if already locked by someone else
        const [rows]: any = await conn.execute(
            'SELECT locked_by, locked_at FROM accounts WHERE id = ?',
            [id]
        );

        const account = rows[0];
        if (account?.locked_by && account.locked_by !== user) {
            // Optional: Auto-unlock if older than 5 mins
            const lockTime = new Date(account.locked_at).getTime();
            if (Date.now() - lockTime < 300000) {
                return res.status(409).json({ error: 'Locked by another user', user: account.locked_by });
            }
        }

        await conn.execute(
            'UPDATE accounts SET locked_by = ?, locked_at = NOW() WHERE id = ?',
            [user, id]
        );
        res.json({ success: true });
    } catch (err: any) {
        res.status(500).json({ error: 'Lock failed' });
    } finally {
        conn.release();
    }
});

router.post('/accounts/:id/unlock', async (req, res) => {
    const conn = await pool.getConnection();
    try {
        const { id } = req.params;
        const user = req.headers['x-user-id'] || 'system';

        await conn.execute(
            'UPDATE accounts SET locked_by = NULL, locked_at = NULL WHERE id = ? AND locked_by = ?',
            [id, user]
        );
        res.json({ success: true });
    } catch (err: any) {
        res.status(500).json({ error: 'Unlock failed' });
    } finally {
        conn.release();
    }
});

// Probe Account (Login Check)
router.post('/accounts/:id/probe', async (req, res) => {
    const conn = await pool.getConnection();
    try {
        const { id } = req.params;
        
        // 1. Set status LOGGING_IN
        await conn.execute('UPDATE accounts SET status = "LOGGING_IN", error_msg = NULL WHERE id = ?', [id]);
        pubRedis.publish('account:update', JSON.stringify({ id, status: 'LOGGING_IN' }));
        
        // 2. Simulate Login (Async)
        // In production, this should trigger a BullMQ job 'probe'
        setTimeout(async () => {
            try {
                // Simulate 2s delay
                await new Promise(r => setTimeout(r, 2000));
                
                // 80% Success Rate Mock
                if (Math.random() > 0.2) {
                    await pool.query('UPDATE accounts SET status = "READY" WHERE id = ?', [id]);
                    pubRedis.publish('account:update', JSON.stringify({ id, status: 'READY' }));
                } else {
                    throw new Error('Simulated Login Failed (Bad Password)');
                }
            } catch (e: any) {
                await pool.query('UPDATE accounts SET status = "ERROR", error_msg = ? WHERE id = ?', [e.message, id]);
                pubRedis.publish('account:update', JSON.stringify({ id, status: 'ERROR', error_msg: e.message }));
            }
        }, 0);

        res.json({ success: true, message: 'Probe started' });
    } catch (err: any) {
        res.status(500).json({ error: 'Probe failed' });
    } finally {
        conn.release();
    }
});

// Disable Account
router.post('/accounts/:id/disable', async (req, res) => {
    const conn = await pool.getConnection();
    try {
        const { id } = req.params;
        await conn.execute('UPDATE accounts SET status = "DISABLED" WHERE id = ?', [id]);
        pubRedis.publish('account:update', JSON.stringify({ id, status: 'DISABLED' }));
        res.json({ success: true });
    } catch (err: any) {
        res.status(500).json({ error: 'Disable failed' });
    } finally {
        conn.release();
    }
});

// TN 协议账号批量导入：支持 accountId, username, password, deviceId, remark, expireAt
router.post('/tn-accounts/import', async (req, res) => {
    const tenantId = Number((req as any).tenantId ?? 1);
    const body = req.body;
    const items = Array.isArray(body) ? body : (body?.items ?? []);
    if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'Missing or empty items array', example: { items: [{ username: '', password: '', deviceId: '', remark: '', expireAt: '' }] } });
    }

    const conn = await pool.getConnection();
    const results = { imported: 0, updated: 0, failed: 0, errors: [] as { index: number; message: string }[] };
    try {
        for (let i = 0; i < items.length; i++) {
            const row = items[i] && typeof items[i] === 'object' ? items[i] : {};
            try {
                if (hasRichImportFields(row as Record<string, unknown>)) {
                    const acc = normalizeImportAccount(row);
                    const missing = getMissingRequiredFields(acc);
                    if (missing.length) {
                        results.failed++;
                        results.errors.push({ index: i, message: `missing required fields: ${missing.join(', ')}` });
                        continue;
                    }

                    const tokenBuf = encrypt(acc.token);
                    const [existingRows]: any = await conn.execute(
                        `SELECT id FROM accounts WHERE phone = ? AND tenant_id = ? LIMIT 1`,
                        [acc.phone, tenantId]
                    );
                    const existingId = existingRows?.[0]?.id ? Number(existingRows[0].id) : null;

                    if (existingId) {
                        const [up]: any = await conn.execute(
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
                        if (up.affectedRows > 0) {
                            results.updated++;
                        } else {
                            results.failed++;
                            results.errors.push({ index: i, message: `account phone ${acc.phone} not found or not owned` });
                        }
                    } else {
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
                        results.imported++;
                    }
                    continue;
                }

                const username = nullable((row as any).username);
                const password = nullable((row as any).password);
                const deviceId = nullable((row as any).deviceId);
                const accountId = (row as any).accountId != null ? Number((row as any).accountId) : null;

                if (!username || !password) {
                    results.failed++;
                    results.errors.push({ index: i, message: 'username and password required' });
                    continue;
                }

                if (accountId && !Number.isNaN(accountId)) {
                    const [up]: any = await conn.execute(
                        `UPDATE accounts SET username=?, password=?, tn_device_model=COALESCE(?, tn_device_model), updated_at=NOW() WHERE id=? AND tenant_id=?`,
                        [username, password, deviceId || null, accountId, tenantId]
                    );
                    if (up.affectedRows > 0) {
                        results.updated++;
                    } else {
                        results.failed++;
                        results.errors.push({ index: i, message: `account id ${accountId} not found or not owned` });
                    }
                } else {
                    await conn.execute(
                        `INSERT INTO accounts (username, password, tn_device_model, status, tenant_id) VALUES (?, ?, ?, 'Ready', ?)`,
                        [username, password, deviceId || null, tenantId]
                    );
                    results.imported++;
                }
            } catch (err: any) {
                results.failed++;
                results.errors.push({ index: i, message: String(err?.message || err) });
            }
        }
        res.json(results);
    } catch (err: any) {
        res.status(500).json({ error: 'Import failed', detail: String(err?.message || err) });
    } finally {
        conn.release();
    }
});

export default router;
