import express from "express";
import { pool } from "../shared/db.js";

const router = express.Router();

let campaignSchemaReady = false;
const ensureCampaignSchema = async () => {
  if (campaignSchemaReady) return;
  const conn = await pool.getConnection();
  try {
    const alterStatements = [
      "ALTER TABLE campaigns ADD COLUMN message_type VARCHAR(20) NOT NULL DEFAULT 'text'",
      "ALTER TABLE campaigns ADD COLUMN direction_mode VARCHAR(20) NOT NULL DEFAULT 'one_way'",
      "ALTER TABLE campaigns ADD COLUMN min_interval INT NOT NULL DEFAULT 300",
      "ALTER TABLE campaigns ADD COLUMN max_interval INT NOT NULL DEFAULT 480",
      "ALTER TABLE campaigns ADD COLUMN tn_account_ids TEXT NULL",
      "ALTER TABLE message_tasks ADD COLUMN message_type VARCHAR(20) NOT NULL DEFAULT 'text'",
      "ALTER TABLE message_tasks ADD COLUMN direction_mode VARCHAR(20) NOT NULL DEFAULT 'one_way'",
    ];

    for (const sql of alterStatements) {
      try {
        await conn.query(sql);
      } catch (err: any) {
        if (err?.code !== "ER_DUP_FIELDNAME") throw err;
      }
    }
    try {
      await conn.query("ALTER TABLE campaigns MODIFY COLUMN media_url MEDIUMTEXT NULL");
    } catch (err: any) {
      if (err?.code !== "ER_BAD_FIELD_ERROR") throw err;
    }
    try {
      await conn.query("ALTER TABLE message_tasks MODIFY COLUMN media_url MEDIUMTEXT NULL");
    } catch (err: any) {
      if (err?.code !== "ER_BAD_FIELD_ERROR") throw err;
    }
    campaignSchemaReady = true;
  } finally {
    conn.release();
  }
};

// Create a new campaign (TC-01)
router.post("/user/campaigns", async (req, res) => {
  await ensureCampaignSchema();
  const {
    name,
    content,
    targets,
    mediaUrl,
    messageType: rawMessageType,
    directionMode: rawDirectionMode,
    minInterval,
    maxInterval,
    tnAccountIds,
  } = req.body;
  const messageType = ["text", "image", "audio", "video"].includes(String(rawMessageType || "").trim())
    ? String(rawMessageType).trim()
    : "text";
  const directionMode = String(rawDirectionMode || "").trim() === "two_way" ? "two_way" : "one_way";
  const normalizedContent = String(content || "").trim();
  const normalizedMediaUrl = String(mediaUrl || "").trim();

  if (!targets) {
    return res.status(400).json({ code: 400, message: "Missing targets" });
  }
  if (messageType === "text" && !normalizedContent) {
    return res.status(400).json({ code: 400, message: "Missing content" });
  }
  if (messageType !== "text" && !normalizedMediaUrl) {
    return res.status(400).json({ code: 400, message: "Missing mediaUrl" });
  }

  const targetList = String(targets).split("\n").map(t => t.trim()).filter(Boolean);
  const tenantId = Number(req.tenantId || 1);
  if (targetList.length === 0) {
    return res.status(400).json({ code: 400, message: "No valid targets" });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Create campaign record
    const [campaignRes]: any = await conn.execute(
      `INSERT INTO campaigns 
        (name, content, media_url, message_type, direction_mode, min_interval, max_interval, tn_account_ids, total_targets, status, tenant_id) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending', ?)`,
      [
        name || "VIP Campaign",
        normalizedContent || null,
        normalizedMediaUrl || null,
        messageType,
        directionMode,
        Math.max(0, Number(minInterval || 300)),
        Math.max(0, Number(maxInterval || 480)),
        Array.isArray(tnAccountIds) ? JSON.stringify(tnAccountIds) : null,
        targetList.length,
        tenantId,
      ]
    );
    const campaignId = campaignRes.insertId;

    // 若创建时选了账号，预填 account_id 以便「使用账号」列立即显示
    const allowedIds: number[] = Array.isArray(tnAccountIds)
      ? tnAccountIds.map((id: any) => Number(id)).filter((id: number) => Number.isFinite(id) && id > 0)
      : [];

    const taskValues = targetList.map((target, index) => {
      const accountId = allowedIds.length > 0 ? allowedIds[index % allowedIds.length] : null;
      return [
        campaignId,
        target,
        normalizedContent || null,
        normalizedMediaUrl || null,
        messageType,
        directionMode,
        'Pending',
        accountId,
        tenantId,
      ];
    });
    if (taskValues.length > 0) {
      await conn.query(
        "INSERT INTO message_tasks (campaign_id, target_phone, content, media_url, message_type, direction_mode, status, account_id, tenant_id) VALUES ?",
        [taskValues]
      );
    }

    await conn.commit();
    res.json({ code: 0, message: "Campaign created", data: { campaignId, count: targetList.length } });
  } catch (err: any) {
    await conn.rollback();
    console.error("Failed to create campaign:", err);
    res.status(500).json({ code: 500, message: "Internal error", detail: err.message });
  } finally {
    conn.release();
  }
});

// 活动列表（多租户：只返回当前租户；任务列表/测试等可复用）
router.get("/user/campaigns", async (req, res) => {
  await ensureCampaignSchema();
  const tenantId = Number(req.tenantId ?? 1);
  const conn = await pool.getConnection();
  try {
    const [rows]: any = await conn.execute(
      `SELECT 
        c.*,
        SUM(CASE WHEN t.status = 'Pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN t.status = 'Processing' THEN 1 ELSE 0 END) as processing,
        SUM(CASE WHEN t.status = 'Sent' THEN 1 ELSE 0 END) as sent,
        SUM(CASE WHEN t.status = 'Failed' THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN t.status = 'Retry' THEN 1 ELSE 0 END) as retry,
        SUM(CASE WHEN t.status = 'Paused' THEN 1 ELSE 0 END) as paused
      FROM campaigns c
      LEFT JOIN message_tasks t ON c.id = t.campaign_id AND t.tenant_id = ?
      WHERE c.tenant_id = ?
      GROUP BY c.id
      ORDER BY c.created_at DESC`,
      [tenantId, tenantId]
    );
    res.json({ code: 0, data: rows });
  } catch (err: any) {
    res.status(500).json({ code: 500, message: "Failed to fetch campaigns", detail: err.message });
  } finally {
    conn.release();
  }
});

// Get individual tasks for a campaign (or all) — 多租户：只返回当前租户
const getTasksHandler = async (req: express.Request, res: express.Response) => {
  await ensureCampaignSchema();
  const tenantId = Number(req.tenantId ?? 1);
  const campaignId = req.query.campaignId;
  const page = Number(req.query.page || 1);
  const limit = Number(req.query.limit || 100);
  const offset = (page - 1) * limit;
  const status = req.query.status as string;

  const conn = await pool.getConnection();
  try {
    let baseQuery = "FROM message_tasks t LEFT JOIN accounts a ON t.account_id = a.id WHERE t.tenant_id = ?";
    const params: any[] = [tenantId];

    if (campaignId) {
      baseQuery += " AND t.campaign_id = ?";
      params.push(campaignId);
    }
    if (status) {
      baseQuery += " AND t.status = ?";
      params.push(status);
    }

    const [countRows]: any = await conn.execute(`SELECT COUNT(*) as total ${baseQuery}`, params);
    const total = countRows[0]?.total || 0;

    const query = `SELECT t.*, a.phone as account_phone ${baseQuery} ORDER BY t.created_at DESC LIMIT ${limit} OFFSET ${offset}`;
    const [rows]: any = await conn.execute(query, params);
    res.json({ code: 0, items: rows, total, page, limit });
  } catch (err: any) {
    res.status(500).json({ code: 500, message: "Failed to fetch tasks", detail: err.message });
  } finally {
    conn.release();
  }
};

// 仅保留一套任务列表：GET /tasks
router.get("/tasks", getTasksHandler);

// Delete task — 多租户：只能删本租户
router.delete("/tasks/:id", async (req, res) => {
  const tenantId = Number(req.tenantId ?? 1);
  const conn = await pool.getConnection();
  try {
    const [r]: any = await conn.execute("DELETE FROM message_tasks WHERE id = ? AND tenant_id = ?", [req.params.id, tenantId]);
    if (r?.affectedRows === 0) {
      return res.status(404).json({ success: false, error: "Task not found or access denied" });
    }
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  } finally {
    conn.release();
  }
});

// Retry task — 多租户：只能重试本租户
router.post("/tasks/:id/retry", async (req, res) => {
  const tenantId = Number(req.tenantId ?? 1);
  const conn = await pool.getConnection();
  try {
    const [r]: any = await conn.execute("UPDATE message_tasks SET status = 'Pending', locked_at = NULL, error_msg = NULL WHERE id = ? AND tenant_id = ?", [req.params.id, tenantId]);
    if (r?.affectedRows === 0) {
      return res.status(404).json({ success: false, error: "Task not found or access denied" });
    }
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  } finally {
    conn.release();
  }
});

// Retry all failed — 多租户：只重试本租户
router.post("/tasks/retry-all", async (req, res) => {
  const tenantId = Number(req.tenantId ?? 1);
  const conn = await pool.getConnection();
  try {
    await conn.execute("UPDATE message_tasks SET status = 'Pending', locked_at = NULL, error_msg = NULL WHERE status = 'Failed' AND tenant_id = ?", [tenantId]);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  } finally {
    conn.release();
  }
});

export default router;
