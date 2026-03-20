import crypto from 'crypto';
import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { pool } from '../shared/db.js';
import { logApiError } from '../utils/audit.js';
import { incrementConversationError, incrementConversationSuccess } from '../middleware/ops.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = express.Router();
const UPLOADS_DIR = path.resolve(process.cwd(), 'uploads');

const sanitizeFileName = (fileName: string) =>
    path.basename(fileName || 'chat-image.png').replace(/[^a-zA-Z0-9._-]/g, '_');

/** 手机号标准化：仅保留数字，去除 +、空格、()、-；必须在 GET /messages、POST /send 及任何以 phone 查询/写入的入口前调用。 */
export function normalizePhone(phone: string): string {
    return String(phone ?? '').replace(/\D/g, '').trim();
}

const getRequestBaseUrl = (req: express.Request) => {
    const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
    const forwardedHost = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
    const protocol = forwardedProto || req.protocol || 'https';
    const host = forwardedHost || req.get('host') || 'localhost';
    return `${protocol}://${host}`;
};

const persistInlineImage = async (req: express.Request, rawMedia: string) => {
    const trimmed = String(rawMedia || '').trim();
    if (!trimmed.startsWith('data:image/')) {
        return trimmed || null;
    }

    const match = trimmed.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (!match) {
        throw new Error('Unsupported image payload');
    }

    const mime = match[1].toLowerCase();
    const payload = match[2];
    const ext = mime.includes('png') ? '.png' : mime.includes('webp') ? '.webp' : mime.includes('gif') ? '.gif' : '.jpg';
    const fileName = `${Date.now()}_${crypto.randomUUID().slice(0, 8)}_${sanitizeFileName(`chat-image${ext}`)}`;
    const absolutePath = path.join(UPLOADS_DIR, fileName);

    await fs.mkdir(UPLOADS_DIR, { recursive: true });
    await fs.writeFile(absolutePath, Buffer.from(payload, 'base64'));
    return `${getRequestBaseUrl(req)}/uploads/${fileName}`;
};

// Get chat messages for a specific peer (tenant-scoped)
// 对应排查：点进去不显示 → 此处用 peerPhone+tenant_id 查 message_tasks，无 conversation id，列表与详情同一租户
// 使用 asyncHandler：未捕获异常会进入全局 errorHandler（计数+审计+统一返回）
router.get('/user/chat/messages', asyncHandler(async (req, res) => {
    const conn = await pool.getConnection();
    try {
        const rawPhone = req.query.peerPhone;
        const peerPhone = normalizePhone(typeof rawPhone === 'string' ? rawPhone : '');
        const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 50));
        const tenantId = Number((req as any).tenantId ?? 1);

        if (!peerPhone) {
            res.status(400).json({ code: 400, message: "Missing or invalid peerPhone" });
            return;
        }

        const [rows]: any = await conn.execute(
            `SELECT 
                id,
                target_phone as peer_phone,
                CASE 
                    WHEN status = 'Received' THEN 'inbound'
                    ELSE 'outbound'
                END as direction,
                content,
                media_url,
                status,
                error_msg,
                created_at
             FROM message_tasks 
             WHERE target_phone = ? AND tenant_id = ?
             ORDER BY created_at ASC
             LIMIT ?`,
            [peerPhone, tenantId, limit]
        );

        incrementConversationSuccess();
        res.json({
            code: 0,
            data: rows
        });
    } finally {
        conn.release();
    }
}));

// Send a message (Manual Chat)
router.post('/user/chat/send', async (req, res) => {
    const conn = await pool.getConnection();
    try {
        const rawPhone = (req.body?.peerPhone ?? '').trim();
        const peerPhone = normalizePhone(rawPhone);
        const text = String(req.body?.content ?? "").trim();
        const media = await persistInlineImage(req, String(req.body?.imageData ?? "").trim());

        if (!peerPhone || (!text && !media)) {
            return res.status(400).json({ code: 400, message: "Missing phone and message payload (text/image)" });
        }

        // Get account used for this peer
        let accountId = null;
        const tenantId = Number((req as any).tenantId ?? 1);

        // 1. Try to find existing conversation's account (same tenant)
        const [existing] : any = await conn.query(
            "SELECT account_id FROM message_tasks WHERE target_phone = ? AND account_id IS NOT NULL AND tenant_id = ? ORDER BY created_at DESC LIMIT 1",
            [peerPhone, tenantId]
        );

        let tenantIdForInsert = tenantId;
        if (existing.length > 0) {
            accountId = existing[0].account_id;
        } else {
            // 2. Fallback: Pick a ready account for this tenant
            const [accounts]: any = await conn.query("SELECT id, tenant_id FROM accounts WHERE status='Ready' AND tenant_id = ? LIMIT 1", [tenantId]);
            if (accounts.length > 0) {
                accountId = accounts[0].id;
                tenantIdForInsert = Number(accounts[0].tenant_id) || tenantId;
            }
        }

        if (!accountId) {
             return res.status(500).json({ code: 500, message: "No available account to send message" });
        }

        const [result]: any = await conn.execute(
            "INSERT INTO message_tasks (account_id, target_phone, content, media_url, status, tenant_id, created_at) VALUES (?, ?, ?, ?, 'Pending', ?, NOW())",
            [accountId, peerPhone, text || "[image]", media || null, tenantIdForInsert]
        );

        // Update contacts table
        await conn.execute(
            `INSERT INTO contacts (phone, last_activity, updated_at) 
             VALUES (?, NOW(), NOW()) 
             ON DUPLICATE KEY UPDATE last_activity = NOW(), updated_at = NOW()`,
            [peerPhone]
        );

        incrementConversationSuccess();
        res.json({ code: 0, message: "Sent", data: { id: result.insertId } });
    } catch (err: any) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.log('⚡ logApiError', { action: 'send', errMsg });
        incrementConversationError("send", "500");
        const targetRef = normalizePhone(String((req as any).body?.peerPhone ?? '').trim());
        await logApiError({
            action: "send",
            targetRef: targetRef || undefined,
            userId: (req as any).userId,
            tenantId: Number((req as any).tenantId ?? 1),
            err: err instanceof Error ? err : new Error(String(err)),
        });
        console.error("Chat send error:", err);
        res.status(500).json({ code: 500, message: "Failed to send message" });
    } finally {
        conn.release();
    }
});

// Get chat accounts (Protocol numbers) — 多租户过滤，返回 sent_count/received_count
router.get('/user/chat/accounts', async (req, res) => {
    const conn = await pool.getConnection();
    try {
        const tenantId = Number((req as any).tenantId ?? 1);
        const limit = Number(req.query.limit || 50);
        const status = req.query.status as string; // 'pinned', 'banned', 'cooldown' etc.

        let whereClause = "WHERE a.tenant_id = ?";
        const params: any[] = [tenantId];
        if (status === 'pinned') whereClause += " AND COALESCE(c.pinned, 0) = 1";
        if (status === 'paused') whereClause += " AND a.status = 'Cooldown'";
        if (status === 'banned') whereClause += " AND (a.status = 'Dead' OR a.status = 'Locked')";

        const [rows]: any = await conn.query(`
            SELECT 
                a.id,
                a.phone,
                a.status,
                (SELECT COUNT(*) FROM message_tasks m WHERE m.account_id = a.id AND m.status = 'Sent') as sent_count,
                (SELECT COUNT(*) FROM message_tasks m WHERE m.account_id = a.id AND m.status = 'Received') as received_count,
                (SELECT COALESCE(SUM(c2.unread_count), 0) FROM message_tasks m
                 INNER JOIN contacts c2 ON c2.phone = m.target_phone WHERE m.account_id = a.id) as unread_count,
                COALESCE(c.pinned, 0) as pinned
            FROM accounts a
            LEFT JOIN contacts c ON c.phone = a.phone
            ${whereClause}
            ORDER BY a.updated_at DESC
            LIMIT ${limit}
        `, params);

        incrementConversationSuccess();
        res.json({
            code: 0,
            data: rows
        });
    } catch (err: any) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.log('⚡ logApiError', { action: 'accounts', errMsg });
        incrementConversationError("accounts", "500");
        await logApiError({
            action: "accounts",
            userId: (req as any).userId,
            tenantId: Number((req as any).tenantId ?? 1),
            err: err instanceof Error ? err : new Error(String(err)),
        });
        console.error("Chat accounts fetch error:", err);
        res.status(500).json({ code: 500, message: "Failed to fetch accounts" });
    } finally {
        conn.release();
    }
});

// Get active conversations list (tenant-scoped; shows contacts who have chatted with us)
router.get('/user/chat/conversations', async (req, res) => {
    const conn = await pool.getConnection();
    try {
        const limitRaw = Number(req.query.limit) || 50;
        const limit = Math.min(500, Math.max(1, Math.floor(limitRaw)));
        const tenantIdRaw = (req as any).tenantId ?? 1;
        const tenantId = Number(tenantIdRaw);
        const tenantIdSafe = Number.isFinite(tenantId) && tenantId >= 0 ? tenantId : 1;

        const [rows]: any = await conn.query(
            `SELECT 
                t.target_phone as phone, 
                MAX(t.created_at) as last_activity,
                (SELECT content FROM message_tasks m2 WHERE m2.target_phone = t.target_phone AND m2.tenant_id = ? ORDER BY created_at DESC LIMIT 1) as last_message,
                (SELECT a.phone FROM accounts a WHERE a.id = (SELECT account_id FROM message_tasks m3 WHERE m3.target_phone = t.target_phone AND m3.tenant_id = ? AND account_id IS NOT NULL ORDER BY created_at DESC LIMIT 1)) as sender_phone,
                (SELECT a2.status FROM accounts a2 WHERE a2.id = (SELECT account_id FROM message_tasks m5 WHERE m5.target_phone = t.target_phone AND m5.tenant_id = ? AND account_id IS NOT NULL ORDER BY created_at DESC LIMIT 1)) as account_status,
                COALESCE(MAX(c.pinned), 0) as pinned,
                COALESCE(MAX(c.banned), 0) as banned,
                COALESCE(MAX(c.deleted), 0) as deleted,
                COALESCE(MAX(c.unread_count), 0) as unread_count,
                (SELECT COUNT(*) FROM message_tasks m4 WHERE m4.target_phone = t.target_phone AND m4.tenant_id = ? AND m4.status = 'Received') as received_count,
                (SELECT COUNT(*) FROM message_tasks m6 WHERE m6.target_phone = t.target_phone AND m6.tenant_id = ? AND m6.status = 'Sent') as sent_count
             FROM message_tasks t
             LEFT JOIN contacts c ON t.target_phone = c.phone
             WHERE t.tenant_id = ?
             GROUP BY t.target_phone
             ORDER BY pinned DESC, last_activity DESC
             LIMIT ` + String(limit),
            [tenantIdSafe, tenantIdSafe, tenantIdSafe, tenantIdSafe, tenantIdSafe, tenantIdSafe]
        );

        incrementConversationSuccess();
        res.json({
            code: 0,
            data: rows
        });
    } catch (err: any) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.log('⚡ logApiError', { action: 'list', errMsg });
        incrementConversationError("list", "500");
        await logApiError({
            action: "list",
            userId: (req as any).userId,
            tenantId: Number((req as any).tenantId ?? 1),
            err: err instanceof Error ? err : new Error(String(err)),
        });
        console.error("Conversations fetch error:", err);
        res.status(500).json({
            code: 500,
            message: err?.message || "Failed to fetch conversations",
            details: process.env.NODE_ENV === "development" ? String(err?.stack) : undefined,
        });
    } finally {
        conn.release();
    }
});

// Allowed contact columns (avoid SQL injection and invalid columns)
const CONTACT_COLUMNS = new Set(['pinned', 'banned', 'deleted', 'unread_count', 'last_activity', 'name', 'updated_at']);

const updateContact = async (phone: string, updates: any) => {
    const conn = await pool.getConnection();
    try {
        const keys = Object.keys(updates).filter(k => CONTACT_COLUMNS.has(k));
        if (keys.length === 0) return true;
        const setClause = keys.map(k => `${k} = ?`).join(', ');
        const values = keys.map(k => updates[k]);
        await conn.execute(
            `INSERT INTO contacts (phone, ${keys.join(', ')}) VALUES (?, ${keys.map(() => '?').join(', ')})
             ON DUPLICATE KEY UPDATE ${setClause}`,
            [phone, ...values, ...values]
        );
        return true;
    } catch (e: any) {
        console.error("updateContact error:", e?.message);
        throw e;
    } finally {
        conn.release();
    }
};

router.post('/user/chat/conversations/:phone/pin', async (req, res) => {
    try {
        const { pinned } = req.body; // true/false
        await updateContact(req.params.phone, { pinned: pinned ? 1 : 0 });
        res.json({ code: 0, message: "Updated" });
    } catch (e: any) {
        res.status(500).json({ code: 500, message: e.message });
    }
});

router.post('/user/chat/conversations/:phone/ban', async (req, res) => {
    try {
        const { banned } = req.body;
        await updateContact(req.params.phone, { banned: banned ? 1 : 0 });
        res.json({ code: 0, message: "Updated" });
    } catch (e: any) {
        res.status(500).json({ code: 500, message: e.message });
    }
});

router.post('/user/chat/conversations/:phone/delete', async (req, res) => {
    try {
        const { deleted } = req.body;
        await updateContact(req.params.phone, { deleted: deleted ? 1 : 0 });
        res.json({ code: 0, message: "Updated" });
    } catch (e: any) {
        res.status(500).json({ code: 500, message: e.message });
    }
});

router.post('/user/chat/conversations/:phone/read', async (req, res) => {
    try {
        await updateContact(req.params.phone, { unread_count: 0 });
        res.json({ code: 0, message: "Marked as read" });
    } catch (e: any) {
        res.status(500).json({ code: 500, message: e.message });
    }
});

export default router;
