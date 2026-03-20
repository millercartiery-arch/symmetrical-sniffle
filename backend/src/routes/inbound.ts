import { Router } from 'express';
import { pool } from '../shared/db.js';

const router = Router();

const normalizePhone = (v: string) => String(v || '').replace(/\D/g, '');

// Inbound webhook for receiving messages (e.g. from Twilio/Vonage/TextNow bridge)
// Body: phone (from/sender), content, to (optional = our number that received the message)
router.post('/inbound/tn', async (req, res) => {
    const { phone, content, to } = req.body;
    const fromPhone = normalizePhone(phone || '');
    const toPhone = to ? normalizePhone(to) : null;

    if (!fromPhone || !content) {
        return res.status(400).json({ error: 'phone (from) & content required' });
    }

    const conn = await pool.getConnection();
    try {
        let accountId: number | null = null;
        let tenantId = 1;

        if (toPhone) {
            const [accRows]: any = await conn.query(
                `SELECT id, tenant_id FROM accounts WHERE REPLACE(REPLACE(REPLACE(REPLACE(phone, ' ', ''), '-', ''), '(', ''), ')', '') = ? OR phone = ? LIMIT 1`,
                [toPhone, toPhone]
            );
            if (accRows.length > 0) {
                accountId = accRows[0].id;
                tenantId = Number(accRows[0].tenant_id) || 1;
            }
        }
        if (accountId == null) {
            const [existing]: any = await conn.query(
                'SELECT account_id, tenant_id FROM message_tasks WHERE target_phone = ? AND account_id IS NOT NULL ORDER BY created_at DESC LIMIT 1',
                [fromPhone]
            );
            if (existing.length > 0) {
                accountId = existing[0].account_id;
                tenantId = Number(existing[0].tenant_id) || 1;
            }
        }

        await conn.execute(
            `INSERT INTO message_tasks (account_id, target_phone, content, status, tenant_id, created_at) VALUES (?, ?, ?, 'Received', ?, NOW())`,
            [accountId, fromPhone, content, tenantId]
        );

        await conn.execute(
            `INSERT INTO contacts (phone, last_activity, updated_at, unread_count) 
             VALUES (?, NOW(), NOW(), 1) 
             ON DUPLICATE KEY UPDATE last_activity = NOW(), updated_at = NOW(), unread_count = unread_count + 1`,
            [fromPhone]
        );

        res.json({ ok: true });
    } catch (e: any) {
        console.error('Inbound error:', e);
        res.status(500).json({ error: e.message });
    } finally {
        conn.release();
    }
});

export default router;
