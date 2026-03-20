/**
 * 卡密激活 + 子账号列表（基于 credentials / card_keys / sub_accounts）
 * 已移除旧的 TN 账号分发逻辑（users 表 batch/distribute）
 */
import express from 'express';
import { pool } from '../shared/db.js';
import { encrypt } from '../shared/crypto.js';
import { ensureCardCredentialSchema } from '../shared/card-credential-schema.js';

const router = express.Router();

function codeEnc(plain: string): string {
  const buf = encrypt(plain);
  return buf.toString('base64');
}

/** 激活卡密 → 创建子账号（事务 + 行锁防并发重复激活） */
router.post('/card/activate', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await ensureCardCredentialSchema(conn);
    const { code, region, weight, proxy_id } = req.body || {};
    const codeStr = String(code ?? '').trim();
    if (!codeStr) return res.status(400).json({ code: 400, error: 'code required' });

    const codeEncVal = codeEnc(codeStr);

    await conn.beginTransaction();
    const [keyRows]: any = await conn.query(
      `SELECT id, type, status, max_use, use_count, valid_from, valid_to
       FROM card_keys WHERE code_enc = ? FOR UPDATE`,
      [codeEncVal]
    );
    if (!keyRows?.length) {
      await conn.rollback();
      conn.release();
      return res.status(403).json({ code: 403, error: '卡密无效或不存在' });
    }
    const key = keyRows[0];

    if (key.status !== 'active' && key.status !== 'used') {
      await conn.rollback();
      conn.release();
      return res.status(403).json({ code: 403, error: `卡密状态不可用: ${key.status}` });
    }
    const now = new Date();
    const validFrom = key.valid_from ? new Date(key.valid_from) : null;
    const validTo = key.valid_to ? new Date(key.valid_to) : null;
    if (validFrom && now < validFrom) {
      await conn.rollback();
      conn.release();
      return res.status(400).json({ code: 400, error: '卡密尚未生效' });
    }
    if (validTo && now > validTo) {
      await conn.rollback();
      conn.release();
      return res.status(410).json({ code: 410, error: '卡密已过期' });
    }
    const maxUse = key.max_use != null ? Number(key.max_use) : null;
    const useCount = Number(key.use_count || 0);
    if (maxUse != null && useCount >= maxUse) {
      await conn.rollback();
      conn.release();
      return res.status(400).json({ code: 400, error: '卡密使用次数已用尽' });
    }

    const [credRows]: any = await conn.query(
      `SELECT id, username FROM credentials WHERE type = ? LIMIT 1`,
      [key.type]
    );
    if (!credRows?.length) {
      await conn.rollback();
      conn.release();
      return res.status(503).json({ code: 503, error: '暂无可用凭证，请联系运维' });
    }
    const cred = credRows[0];
    const credId = cred.id;
    const credentialUsername = cred.username;

    const weightVal = Math.min(100, Math.max(1, Number(weight) || 1));
    const tenantId = Number(req.body?.tenant_id ?? req.headers?.['x-tenant-id'] ?? 1);

    await conn.query(
      `INSERT INTO sub_accounts (card_key_id, credential_id, region, weight, proxy_id, enabled, status, tenant_id)
       VALUES (?, ?, ?, ?, ?, 1, 'ready', ?)`,
      [key.id, credId, region || null, weightVal, proxy_id ?? null, tenantId]
    );
    const [ins]: any = await conn.query('SELECT LAST_INSERT_ID() AS id');
    const subAccountId = ins?.[0]?.id;

    const newUse = useCount + 1;
    const newStatus = maxUse != null && newUse >= maxUse ? 'used' : key.status;
    await conn.query(`UPDATE card_keys SET use_count = ?, status = ?, updated_at = NOW() WHERE id = ?`, [newUse, newStatus, key.id]);

    await conn.commit();
    res.json({
      code: 0,
      data: {
        sub_account_id: subAccountId,
        use_count: newUse,
        status: newStatus,
        credential_username: credentialUsername,
      },
    });
  } catch (e: any) {
    try {
      await conn.rollback();
    } catch (_) {}
    res.status(500).json({ code: 500, error: e?.message || 'activate failed' });
  } finally {
    conn.release();
  }
});

const SUB_ACCOUNT_RESPONSE_FIELDS = [
  'id', 'card_key_id', 'credential_id', 'region', 'weight', 'proxy_id',
  'rate_limit', 'rate_counter', 'rate_reset_at', 'status', 'is_busy', 'enabled',
  'tenant_id', 'created_at', 'updated_at',
  'credential_type', 'credential_username', 'card_type', 'card_status', 'card_use_count', 'card_max_use',
];

function pickSubAccountPublic(row: any) {
  const out: Record<string, unknown> = {};
  for (const k of SUB_ACCOUNT_RESPONSE_FIELDS) {
    if (row && k in row) out[k] = row[k];
  }
  return out;
}

/** 子账号列表（分页 + 过滤，仅返回安全字段，不含 password_hash/password_cipher） */
router.get('/sub-accounts', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await ensureCardCredentialSchema(conn);
    const page = Math.max(1, parseInt(String(req.query.page)) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(String(req.query.limit)) || 20));
    const offset = (page - 1) * limit;
    // 以 JWT 注入的 tenantId 为准；query 仅作为兼容（无登录调试）时的覆盖
    const tenantId = Number((req as any).tenantId ?? req.query.tenant_id ?? 1);
    const status = req.query.status as string | undefined;
    const region = req.query.region as string | undefined;
    const proxyId = req.query.proxy_id as string | undefined;

    let whereClause = 'WHERE s.tenant_id = ?';
    const params: any[] = [tenantId];
    if (status && status.trim()) {
      whereClause += ' AND s.status = ?';
      params.push(status.trim());
    }
    if (region && region.trim()) {
      whereClause += ' AND s.region = ?';
      params.push(region.trim());
    }
    if (proxyId !== undefined && proxyId !== '') {
      const p = parseInt(proxyId, 10);
      if (!Number.isNaN(p)) {
        whereClause += ' AND s.proxy_id = ?';
        params.push(p);
      }
    }

    const [countRows]: any = await conn.query(
      `SELECT COUNT(*) AS total FROM sub_accounts s
       LEFT JOIN credentials c ON c.id = s.credential_id
       LEFT JOIN card_keys k ON k.id = s.card_key_id
       ${whereClause}`,
      params
    );
    const total = Number(countRows?.[0]?.total ?? 0);

    const [rows]: any = await conn.query(
      `SELECT s.id, s.card_key_id, s.credential_id, s.region, s.weight, s.proxy_id,
              s.rate_limit, s.rate_counter, s.rate_reset_at, s.status, s.is_busy, s.enabled,
              s.tenant_id, s.created_at, s.updated_at,
              c.type AS credential_type, c.username AS credential_username,
              k.type AS card_type, k.status AS card_status, k.use_count AS card_use_count, k.max_use AS card_max_use
       FROM sub_accounts s
       LEFT JOIN credentials c ON c.id = s.credential_id
       LEFT JOIN card_keys k ON k.id = s.card_key_id
       ${whereClause}
       ORDER BY s.id DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    res.json({
      code: 0,
      items: (Array.isArray(rows) ? rows : []).map(pickSubAccountPublic),
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    });
  } catch (e: any) {
    res.status(500).json({ error: 'Failed to fetch sub-accounts', detail: e?.message });
  } finally {
    conn.release();
  }
});

/** 更新子账号（仅允许 status / weight / proxy_id / region / enabled） */
router.patch('/sub-accounts/:id', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await ensureCardCredentialSchema(conn);
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id) || id < 1) return res.status(400).json({ code: 400, error: 'Invalid id' });

    const { status, weight, proxy_id, region, enabled } = req.body || {};
    const updates: string[] = [];
    const values: any[] = [];
    if (status !== undefined) {
      updates.push('status = ?');
      values.push(String(status).trim() || 'ready');
    }
    if (weight !== undefined) {
      const w = Math.min(100, Math.max(1, Number(weight) || 1));
      updates.push('weight = ?');
      values.push(w);
    }
    if (proxy_id !== undefined) {
      updates.push('proxy_id = ?');
      values.push(proxy_id === null || proxy_id === '' ? null : parseInt(proxy_id, 10));
    }
    if (region !== undefined) {
      updates.push('region = ?');
      values.push(region === null || region === '' ? null : String(region).trim());
    }
    if (enabled !== undefined) {
      updates.push('enabled = ?');
      values.push(enabled ? 1 : 0);
    }
    if (!updates.length) return res.status(400).json({ code: 400, error: 'No fields to update' });

    values.push(id);
    const [result]: any = await conn.query(
      `UPDATE sub_accounts SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ?`,
      values
    );
    if (Number(result?.affectedRows || 0) === 0) return res.status(404).json({ code: 404, error: 'Sub-account not found' });
    res.json({ code: 0, data: { id, updated: updates.length } });
  } catch (e: any) {
    res.status(500).json({ code: 500, error: e?.message || 'update failed' });
  } finally {
    conn.release();
  }
});

/** 删除子账号（物理删除，调度将不再选中） */
router.delete('/sub-accounts/:id', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await ensureCardCredentialSchema(conn);
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id) || id < 1) return res.status(400).json({ code: 400, error: 'Invalid id' });

    const [result]: any = await conn.query('DELETE FROM sub_accounts WHERE id = ?', [id]);
    if (Number(result?.affectedRows || 0) === 0) return res.status(404).json({ code: 404, error: 'Sub-account not found' });
    res.json({ code: 0, data: { id, deleted: true } });
  } catch (e: any) {
    res.status(500).json({ code: 500, error: e?.message || 'delete failed' });
  } finally {
    conn.release();
  }
});

export default router;
