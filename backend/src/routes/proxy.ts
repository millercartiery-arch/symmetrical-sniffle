
import { Router } from 'express';
import { pool } from '../shared/db.js';
import axios from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { dispatchEngine, ensureDispatchEngineStarted } from '../gateway/runtime.js';
import { ensureProxySchema } from '../shared/proxy-schema.js';
import { ensureCardCredentialSchema } from '../shared/card-credential-schema.js';
import { encryptProxyPassword, decryptProxyPassword } from '../shared/crypto.js';

const router = Router();

/** 从 proxy 行解析明文密码（优先 auth_pass_enc 解密，兼容旧 password 列） */
function getProxyPasswordPlain(row: { auth_pass_enc?: string | null; password?: string | null }): string {
  if (row.auth_pass_enc) return decryptProxyPassword(row.auth_pass_enc);
  return String(row.password ?? '').trim();
}

function getOperatorId(req: any): string | null {
  const id = req?.user?.id ?? req?.headers?.['x-operator-id'];
  return id != null ? String(id) : null;
}
const PROXY_PROBE_TIMEOUT_MS = Math.max(1200, Number(process.env.PROXY_PROBE_TIMEOUT_MS || 4500));
const PROXY_PROBE_CONCURRENCY = Math.max(1, Math.min(20, Number(process.env.PROXY_PROBE_CONCURRENCY || 8)));

type ProxyProbeRow = {
    id: number;
    protocol: string;
    host: string;
    port: number;
    username?: string | null;
    password?: string | null;
    auth_pass_enc?: string | null;
    status?: string | null;
    country?: string | null;
    region?: string | null;
    city?: string | null;
    account_bind_count?: number;
};

type ProbedProxyStatus = {
    id: number;
    proxyUrl: string;
    alive: boolean;
    latencyMs: number | null;
    ip: string | null;
    country: string | null;
    region: string | null;
    city: string | null;
    error?: string;
    accountBindCount: number;
};

/** 从 proxy 行（含 auth_pass_enc 或 password）构建代理 URL，不暴露明文到日志 */
function buildProxyUrl(proxy: {
    protocol?: string | null;
    host: string;
    port: number;
    username?: string | null;
    password?: string | null;
    auth_pass_enc?: string | null;
}): string {
    const protocol = String(proxy.protocol || 'http').trim() || 'http';
    const plain = getProxyPasswordPlain(proxy);
    const auth =
        proxy.username
            ? `${encodeURIComponent(String(proxy.username))}:${encodeURIComponent(plain)}@`
            : '';
    return `${protocol}://${auth}${proxy.host}:${proxy.port}`;
}

async function runWithConcurrency<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
    const batchLimit = Math.max(1, limit);
    let cursor = 0;
    const runners = Array.from({ length: Math.min(batchLimit, items.length) }, async () => {
        while (cursor < items.length) {
            const index = cursor++;
            await worker(items[index]);
        }
    });
    await Promise.all(runners);
}

function redactProxyUrl(url: string): string {
    try {
        const u = new URL(url);
        if (u.username || u.password) u.username = u.password = '***';
        return u.toString();
    } catch {
        return url.replace(/:[^:@]+@/, ':***@');
    }
}

async function probeProxyStatus(proxy: ProxyProbeRow): Promise<ProbedProxyStatus> {
    const proxyUrl = buildProxyUrl(proxy);
    const startedAt = Date.now();
    try {
        const agent = new HttpsProxyAgent(proxyUrl);
        const response = await axios.get('https://ipapi.co/json/', {
            httpsAgent: agent,
            timeout: PROXY_PROBE_TIMEOUT_MS,
            validateStatus: () => true,
            headers: { 'user-agent': 'massmail-proxy-probe/1.0' },
        });
        const latencyMs = Date.now() - startedAt;
        const payload = (response?.data || {}) as Record<string, any>;
        const ip = String(payload.ip || '').trim() || null;
        const country = String(payload.country_name || payload.country || '').trim() || null;
        const region = String(payload.region || '').trim() || null;
        const city = String(payload.city || '').trim() || null;
        const alive = response.status >= 200 && response.status < 400 && !!ip;

        return {
            id: Number(proxy.id),
            proxyUrl: redactProxyUrl(proxyUrl),
            alive,
            latencyMs,
            ip,
            country,
            region,
            city,
            accountBindCount: Number(proxy.account_bind_count || 0),
            error: alive ? undefined : `probe_status_${response.status}`,
        };
    } catch (error: any) {
        return {
            id: Number(proxy.id),
            proxyUrl: redactProxyUrl(proxyUrl),
            alive: false,
            latencyMs: null,
            ip: null,
            country: null,
            region: null,
            city: null,
            accountBindCount: Number(proxy.account_bind_count || 0),
            error: String(error?.message || 'probe_failed'),
        };
    }
}

router.use(async (_req, res, next) => {
    const conn = await pool.getConnection();
    try {
        await ensureProxySchema(conn);
        await ensureCardCredentialSchema(conn);
        next();
    } catch (error: any) {
        res.status(500).json({ code: 500, error: error?.message || 'proxy schema ensure failed' });
    } finally {
        conn.release();
    }
});

// List proxies (with pagination and filters)
router.get('/proxies', async (req, res) => {
    const conn = await pool.getConnection();
    try {
        const page = Math.max(1, parseInt(String(req.query.page)) || 1);
        const pageSize = Math.min(100, Math.max(1, parseInt(String(req.query.pageSize)) || 20));
        const offset = (page - 1) * pageSize;
        const search = String(req.query.search || '').trim();
        const protocol = String(req.query.protocol || '').trim();
        const enabled = req.query.enabled;
        const region = String(req.query.region || '').trim();

        let where = '1=1';
        const params: any[] = [];
        if (search) {
            where += ' AND (p.host LIKE ? OR p.description LIKE ? OR p.region LIKE ?)';
            const term = `%${search}%`;
            params.push(term, term, term);
        }
        if (protocol) {
            where += ' AND p.protocol = ?';
            params.push(protocol);
        }
        if (enabled !== undefined && enabled !== '') {
            where += ' AND p.is_active = ?';
            const en = String(enabled ?? '').toLowerCase();
            params.push(en === '1' || en === 'true' ? 1 : 0);
        }
        if (region) {
            where += ' AND p.region = ?';
            params.push(region);
        }

        const [countRows]: any = await conn.query(
            `SELECT COUNT(*) AS total FROM proxies p WHERE ${where}`,
            params
        );
        const total = countRows?.[0]?.total ?? 0;

        const [rows] = await conn.query(
            `SELECT p.id, p.protocol, p.host, p.port, p.username, p.description, p.region, p.tags, p.weight,
                    p.is_active, p.status, p.country, p.city, p.last_checked_at, p.last_latency_ms, p.last_alive,
                    p.last_success_at, p.last_error_msg, p.created_at, p.updated_at,
                    (SELECT COUNT(*) FROM account_proxy_bindings ap WHERE ap.proxy_id = p.id AND ap.is_active = 1)
                    + (SELECT COUNT(*) FROM sub_accounts s WHERE s.proxy_id = p.id) AS bind_count
             FROM proxies p
             WHERE ${where}
             ORDER BY p.updated_at DESC, p.id DESC
             LIMIT ? OFFSET ?`,
            [...params, pageSize, offset]
        );
        res.json({ code: 0, data: rows, list: rows, total, pagination: { page, pageSize, total } });
    } catch (e: any) {
        res.status(500).json({ code: 500, error: e.message });
    } finally {
        conn.release();
    }
});

router.get('/proxies/bindings', async (_req, res) => {
    const conn = await pool.getConnection();
    try {
        const [rows] = await conn.query(
            `SELECT ap.id, ap.account_id, ap.proxy_id, ap.session_key, ap.is_primary, ap.is_active,
                    p.protocol, p.host, p.port
             FROM account_proxy_bindings ap
             INNER JOIN proxies p ON p.id = ap.proxy_id
             ORDER BY ap.account_id ASC, ap.is_primary DESC, ap.id ASC`
        );
        res.json({ code: 0, data: rows });
    } catch (e: any) {
        res.status(500).json({ code: 500, error: e.message });
    } finally {
        conn.release();
    }
});

router.post('/proxies/bind', async (req, res) => {
    const accountId = Number(req.body?.accountId);
    const proxyId = Number(req.body?.proxyId);
    const isPrimary = Number(req.body?.isPrimary ? 1 : 0);
    const sessionKey = String(req.body?.sessionKey || `acc-${accountId}`).trim();
    if (!accountId || !proxyId || !sessionKey) {
        return res.status(400).json({ code: 400, error: 'accountId, proxyId, sessionKey are required' });
    }
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        if (isPrimary) {
            await conn.query('UPDATE account_proxy_bindings SET is_primary = 0 WHERE account_id = ?', [accountId]);
        }
        await conn.query(
            `INSERT INTO account_proxy_bindings (account_id, proxy_id, session_key, is_primary, is_active)
             VALUES (?, ?, ?, ?, 1)
             ON DUPLICATE KEY UPDATE session_key = VALUES(session_key), is_primary = VALUES(is_primary), is_active = 1`,
            [accountId, proxyId, sessionKey, isPrimary]
        );
        await conn.commit();
        res.json({ code: 0, message: 'binding saved' });
    } catch (e: any) {
        await conn.rollback();
        res.status(500).json({ code: 500, error: e.message });
    } finally {
        conn.release();
    }
});

// Get single proxy (must be after /proxies/bindings and /proxies/bind)
router.get('/proxies/:id', async (req, res) => {
    const conn = await pool.getConnection();
    try {
        const [rows]: any = await conn.query(
            `SELECT p.id, p.protocol, p.host, p.port, p.username, p.description, p.region, p.tags, p.weight,
                    p.is_active, p.status, p.country, p.city, p.last_checked_at, p.last_latency_ms, p.last_alive,
                    p.last_success_at, p.last_error_msg, p.created_at, p.updated_at,
                    (SELECT COUNT(*) FROM account_proxy_bindings ap WHERE ap.proxy_id = p.id AND ap.is_active = 1)
                    + (SELECT COUNT(*) FROM sub_accounts s WHERE s.proxy_id = p.id) AS bind_count
             FROM proxies p WHERE p.id = ?`,
            [req.params.id]
        );
        if (!rows?.length) return res.status(404).json({ code: 404, error: 'Not found' });
        res.json({ code: 0, data: rows[0] });
    } catch (e: any) {
        res.status(500).json({ code: 500, error: e.message });
    } finally {
        conn.release();
    }
});

router.get('/system/proxies/status', async (_req, res) => {
    const conn = await pool.getConnection();
    try {
        const [rows] = await conn.query(
            `SELECT p.id,
                    p.protocol,
                    p.host,
                    p.port,
                    p.username,
                    p.password,
                    p.auth_pass_enc,
                    p.status,
                    p.country,
                    p.region,
                    p.city,
                    COUNT(ap.id) AS account_bind_count
             FROM proxies p
             LEFT JOIN account_proxy_bindings ap
               ON ap.proxy_id = p.id
              AND ap.is_active = 1
             WHERE p.is_active = 1
             GROUP BY p.id, p.protocol, p.host, p.port, p.username, p.password, p.auth_pass_enc, p.status, p.country, p.region, p.city
             ORDER BY p.id DESC`
        ) as any[];

        const proxyRows = (rows || []) as ProxyProbeRow[];
        const probedResults: ProbedProxyStatus[] = [];
        await runWithConcurrency(proxyRows, PROXY_PROBE_CONCURRENCY, async (proxy) => {
            const status = await probeProxyStatus(proxy);
            probedResults.push(status);
        });

        await Promise.all(
            probedResults.map((item) =>
                conn.query(
                    `UPDATE proxies
                     SET last_checked_at = NOW(),
                         last_alive = ?,
                         last_latency_ms = ?,
                         country = COALESCE(?, country),
                         region = COALESCE(?, region),
                         city = COALESCE(?, city),
                         status = ?
                     WHERE id = ?`,
                    [
                        item.alive ? 1 : 0,
                        item.latencyMs,
                        item.country,
                        item.region,
                        item.city,
                        item.alive ? 'Active' : 'Dead',
                        item.id,
                    ]
                )
            )
        );

        const aliveItems = probedResults.filter((item) => item.alive);
        const avgLatencyMs = aliveItems.length
            ? Math.round(aliveItems.reduce((sum, item) => sum + Number(item.latencyMs || 0), 0) / aliveItems.length)
            : null;

        res.json({
            code: 0,
            data: {
                total: probedResults.length,
                alive: aliveItems.length,
                dead: probedResults.length - aliveItems.length,
                avgLatencyMs,
                checkedAt: new Date().toISOString(),
                items: probedResults.sort((a, b) => a.id - b.id),
            },
        });
    } catch (e: any) {
        res.status(500).json({ code: 500, error: e?.message || 'proxy status probe failed' });
    } finally {
        conn.release();
    }
});

// Create single proxy or bulk (body.proxies array)
router.post('/proxies', async (req, res) => {
    const body = req.body || {};
    const conn = await pool.getConnection();
    try {
        if (Array.isArray(body.proxies) && body.proxies.length > 0) {
            await ensureDispatchEngineStarted();
            const operatorId = getOperatorId(req);
            await conn.beginTransaction();
            let added = 0;
            let errors = 0;
            const addedNodes: Array<{ protocol: string; host: string; port: number; username?: string; password?: string }> = [];
            try {
                for (const p of body.proxies) {
                    let protocol = 'http';
                    let host: string | undefined, port: number | undefined, username: string | undefined, password: string | undefined;
                    if (typeof p === 'string') {
                        try {
                            if (p.includes('://')) {
                                const url = new URL(p);
                                protocol = url.protocol.replace(':', '');
                                host = url.hostname;
                                port = Number(url.port);
                                username = url.username || undefined;
                                password = url.password || undefined;
                            } else {
                                const parts = p.split(':');
                                if (parts.length === 2) [host, port] = [parts[0], Number(parts[1])];
                                else if (parts.length === 4) [host, port, username, password] = [parts[0], Number(parts[1]), parts[2], parts[3]];
                                else throw new Error('Invalid format');
                            }
                        } catch {
                            errors++;
                            continue;
                        }
                    } else {
                        ({ protocol = 'http', host, port, username, password } = p);
                    }
                    if (!host || !port) { errors++; continue; }
                    const passEnc = password ? encryptProxyPassword(String(password)) : null;
                    try {
                        const [ins]: any = await conn.query(
                            `INSERT IGNORE INTO proxies (protocol, host, port, username, password, auth_pass_enc, status, created_at) VALUES (?, ?, ?, ?, NULL, ?, 'Active', NOW())`,
                            [protocol, host, port, username || null, passEnc]
                        );
                        if (ins?.affectedRows) {
                            added++;
                            const id = ins?.insertId;
                            if (id) await conn.query('INSERT INTO proxy_audit (proxy_id, action, operator_id, detail) VALUES (?, ?, ?, ?)', [id, 'create', operatorId, JSON.stringify({ host, port })]);
                        }
                        addedNodes.push({ protocol, host, port: Number(port), username, password });
                    } catch {
                        errors++;
                    }
                }
                await conn.commit();
            } catch (e) {
                await conn.rollback();
                throw e;
            }
            if (addedNodes.length) dispatchEngine.upsertProxyNodes(addedNodes);
            return res.json({ code: 0, message: `Added ${added} proxies, ${errors} failed/skipped` });
        }

        const { protocol, host, port, username, password, description, region, tags, weight, enabled } = body;
        if (!host || !port) return res.status(400).json({ code: 400, error: 'host and port required' });
        const proto = String(protocol || 'http').toLowerCase();
        if (!['http', 'https', 'socks4', 'socks5'].includes(proto)) return res.status(400).json({ code: 400, error: 'invalid protocol' });
        const portNum = parseInt(String(port), 10);
        if (portNum < 1 || portNum > 65535) return res.status(400).json({ code: 400, error: 'port must be 1-65535' });
        const tagsJson = Array.isArray(tags) ? JSON.stringify(tags) : (typeof tags === 'string' ? tags : null);
        const weightVal = Math.min(100, Math.max(1, parseInt(String(weight), 10) || 1));
        const isActive = enabled !== false && enabled !== 0 ? 1 : 0;
        const authPassEnc = password ? encryptProxyPassword(String(password)) : null;

        const [result]: any = await conn.query(
            `INSERT INTO proxies (protocol, host, port, username, password, auth_pass_enc, description, region, tags, weight, is_active, status, created_at)
             VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, 'Active', NOW())`,
            [proto, String(host).trim(), portNum, username || null, authPassEnc, description || null, region || null, tagsJson, weightVal, isActive]
        );
        const id = result?.insertId;
        await conn.query('INSERT INTO proxy_audit (proxy_id, action, operator_id, detail) VALUES (?, ?, ?, ?)', [id, 'create', getOperatorId(req), JSON.stringify({ host, port })]);
        res.json({ code: 0, data: { id }, id });
    } catch (e: any) {
        const code = e?.code ?? e?.errno;
        if (code === 'ER_DUP_ENTRY' || code === 1062) return res.status(409).json({ code: 409, error: 'Duplicate proxy (same protocol, host, port, username)' });
        res.status(500).json({ code: 500, error: e.message });
    } finally {
        conn.release();
    }
});

// Update single proxy
router.patch('/proxies/:id', async (req, res) => {
    const id = req.params.id;
    const body = req.body || {};
    const conn = await pool.getConnection();
    try {
        const [rows]: any = await conn.query('SELECT id FROM proxies WHERE id = ?', [id]);
        if (!rows?.length) return res.status(404).json({ code: 404, error: 'Not found' });

        const allowed = ['protocol', 'host', 'port', 'username', 'password', 'description', 'region', 'tags', 'weight', 'is_active'];
        const updates: string[] = [];
        const values: any[] = [];
        if (body.protocol !== undefined) { updates.push('protocol = ?'); values.push(String(body.protocol).toLowerCase()); }
        if (body.host !== undefined) { updates.push('host = ?'); values.push(String(body.host).trim()); }
        if (body.port !== undefined) { updates.push('port = ?'); values.push(parseInt(String(body.port), 10)); }
        if (body.username !== undefined) { updates.push('username = ?'); values.push(body.username || null); }
        if (body.password !== undefined) {
            updates.push('auth_pass_enc = ?'); values.push(encryptProxyPassword(String(body.password)));
            updates.push('password = NULL');
        }
        if (body.description !== undefined) { updates.push('description = ?'); values.push(body.description || null); }
        if (body.region !== undefined) { updates.push('region = ?'); values.push(body.region || null); }
        if (body.tags !== undefined) { updates.push('tags = ?'); values.push(Array.isArray(body.tags) ? JSON.stringify(body.tags) : body.tags); }
        if (body.weight !== undefined) { updates.push('weight = ?'); values.push(Math.min(100, Math.max(1, parseInt(String(body.weight), 10) || 1))); }
        if (body.enabled !== undefined) { updates.push('is_active = ?'); values.push(body.enabled !== false && body.enabled !== 0 ? 1 : 0); }

        if (updates.length === 0) return res.json({ code: 0, updated: true });
        values.push(id);
        await conn.query(`UPDATE proxies SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ?`, values);
        await conn.query('INSERT INTO proxy_audit (proxy_id, action, operator_id, detail) VALUES (?, ?, ?, ?)', [id, 'update', getOperatorId(req), JSON.stringify(Object.keys(body))]);
        res.json({ code: 0, updated: true });
    } catch (e: any) {
        const code = e?.code ?? e?.errno;
        if (code === 'ER_DUP_ENTRY' || code === 1062) return res.status(409).json({ code: 409, error: 'Duplicate proxy (same protocol, host, port, username)' });
        res.status(500).json({ code: 500, error: e.message });
    } finally {
        conn.release();
    }
});

// Delete proxy（软删除：禁用 + 解除子账号绑定，不删行；物理删除时 FK ON DELETE SET NULL 仍生效）
router.delete('/proxies/:id', async (req, res) => {
    const conn = await pool.getConnection();
    try {
        const [rows]: any = await conn.query('SELECT id FROM proxies WHERE id = ?', [req.params.id]);
        if (!rows?.length) return res.status(404).json({ code: 404, error: 'Not found' });
        await conn.query('INSERT INTO proxy_audit (proxy_id, action, operator_id, detail) VALUES (?, ?, ?, ?)', [req.params.id, 'delete', getOperatorId(req), JSON.stringify({ soft: true })]);
        await conn.query('UPDATE proxies SET is_active = 0, updated_at = NOW() WHERE id = ?', [req.params.id]);
        await conn.query('UPDATE sub_accounts SET proxy_id = NULL WHERE proxy_id = ?', [req.params.id]);
        res.json({ code: 0, message: 'Deleted', soft: true });
    } catch (e: any) {
        res.status(500).json({ code: 500, error: e.message });
    } finally {
        conn.release();
    }
});

const PING_URL_DEFAULT = 'https://api.tn.com/ping';

async function runSingleProxyTest(conn: any, proxy: any, pingUrl: string): Promise<{ ok: boolean; latency?: number; status?: number; error?: string }> {
    const proxyUrl = buildProxyUrl(proxy);
    const start = Date.now();
    try {
        const agent = new HttpsProxyAgent(proxyUrl);
        const response = await axios.get(pingUrl, {
            httpsAgent: agent,
            timeout: 10000,
            validateStatus: () => true,
            headers: { 'user-agent': 'massmail-proxy-probe/1.0' },
        });
        const latency = Date.now() - start;
        const ok = response.status >= 200 && response.status < 400;
        await conn.query(
            `UPDATE proxies SET last_checked_at = NOW(), last_alive = ?, last_latency_ms = ?, status = ?,
             last_success_at = ?, last_error_msg = ?
             WHERE id = ?`,
            [ok ? 1 : 0, latency, ok ? 'Active' : 'Dead', ok ? new Date() : null, ok ? null : `HTTP ${response.status}`, proxy.id]
        );
        return { ok, latency, status: response.status, error: ok ? undefined : `HTTP ${response.status}` };
    } catch (e: any) {
        const errMsg = String(e?.message || 'Connection failed');
        await conn.query(
            `UPDATE proxies SET last_checked_at = NOW(), last_alive = 0, last_error_msg = ? WHERE id = ?`,
            [errMsg.substring(0, 2000), proxy.id]
        );
        return { ok: false, error: errMsg };
    }
}

// Test single proxy (design: POST /proxies/:id/test)
router.post('/proxies/:id/test', async (req, res) => {
    const conn = await pool.getConnection();
    try {
        const pingUrl = String(req.body?.pingUrl || PING_URL_DEFAULT).trim() || PING_URL_DEFAULT;
        const [rows]: any = await conn.query('SELECT * FROM proxies WHERE id = ?', [req.params.id]);
        if (!rows?.length) return res.status(404).json({ code: 404, error: 'Not found' });
        const result = await runSingleProxyTest(conn, rows[0], pingUrl);
        await conn.query('INSERT INTO proxy_audit (proxy_id, action, operator_id, detail) VALUES (?, ?, ?, ?)', [req.params.id, 'test', getOperatorId(req), JSON.stringify(result)]);
        res.json({ code: 0, ...result });
    } catch (e: any) {
        res.status(500).json({ code: 500, error: e.message });
    } finally {
        conn.release();
    }
});

export default router;
