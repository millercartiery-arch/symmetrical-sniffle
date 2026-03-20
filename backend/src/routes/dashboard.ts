
import express from "express";
import { pool } from "../shared/db.js";

const router = express.Router();

let workTaskSchemaReady = false;
const ensureWorkTaskSchema = async () => {
  if (workTaskSchemaReady) return;
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
    workTaskSchemaReady = true;
  } finally {
    conn.release();
  }
};

// Real dashboard stats
router.get("/dashboard/stats", async (_req, res) => {
  const conn = await pool.getConnection();
  try {
    // Task Stats
    const [taskStats]: any = await conn.query(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'Sent' THEN 1 ELSE 0 END) as sent,
        SUM(CASE WHEN status = 'Failed' THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN status = 'Pending' OR status = 'Processing' THEN 1 ELSE 0 END) as running
      FROM message_tasks
    `);
    const tasks = taskStats[0];
    const completionRate = tasks.total > 0 ? Math.round((tasks.sent / tasks.total) * 100) : 0;

    // Account Stats
    const [accStats]: any = await conn.query(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'Ready' THEN 1 ELSE 0 END) as ready,
        SUM(CASE WHEN status = 'Cooldown' THEN 1 ELSE 0 END) as cooldown,
        SUM(CASE WHEN status = 'Dead' OR status = 'Locked' THEN 1 ELSE 0 END) as dead
      FROM accounts
    `);
    const accounts = accStats[0];

    // Today's Stats
    const [todayStats]: any = await conn.query(`
      SELECT 
        SUM(CASE WHEN status = 'Sent' AND created_at >= CURDATE() THEN 1 ELSE 0 END) as sent,
        SUM(CASE WHEN status = 'Failed' AND created_at >= CURDATE() THEN 1 ELSE 0 END) as failed
      FROM message_tasks
    `);
    const today = todayStats[0];

    // Running & Success Rate
    const totalSent = tasks.sent || 0;
    const totalTasks = tasks.total || 0;
    // const completionRate = totalTasks > 0 ? Math.round((totalSent / totalTasks) * 100) : 0; // Removed duplicate declaration

    res.json({
      task: {
        total: tasks.total || 0,
        inProgress: tasks.running || 0,
        completed: completionRate, // Use as %
        failed: tasks.failed || 0,
        successRate: completionRate
      },
      account: {
        total: accounts.total || 0,
        online: accounts.ready || 0,
        offline: accounts.dead || 0, // Using Dead/Locked as offline/invalid
        cooldown: accounts.cooldown || 0,
        todaySent: today.sent || 0,
        todayFailed: today.failed || 0
      }
    });
  } catch (e: any) {
    console.error("Dashboard stats error:", e);
    res.status(500).json({ error: e.message });
  } finally {
    conn.release();
  }
});

// Real recent activities
router.get("/dashboard/activities", async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const limit = Number(req.query.limit || 20);
    
    // Combine logs from different tables or just use audit_logs + recent tasks
    // For now, let's use recent message tasks as activities
    const [rows]: any = await conn.query(`
      SELECT 
        id, 
        target_phone, 
        status, 
        created_at 
      FROM message_tasks 
      ORDER BY created_at DESC 
      LIMIT ?
    `, [limit]);

    const items = rows.map((r: any) => ({
      message: `Message to ${r.target_phone} - ${r.status}`,
      createdAt: r.created_at,
      color: r.status === 'Sent' ? 'green' : (r.status === 'Failed' ? 'red' : 'blue')
    }));

    res.json({ items });
  } catch (e: any) {
    console.error("Dashboard activities error:", e);
    res.status(500).json({ error: e.message });
  } finally {
    conn.release();
  }
});

// Real work tasks (Campaigns)
router.get("/work-tasks", async (_req, res) => {
  await ensureWorkTaskSchema();
  const conn = await pool.getConnection();
  try {
    const [rows]: any = await conn.query(`
      SELECT 
        c.id, 
        c.name as title, 
        c.status,
        c.message_type,
        c.direction_mode,
        c.min_interval,
        c.max_interval,
        c.tn_account_ids,
        c.created_at,
        (SELECT COUNT(*) FROM message_tasks t WHERE t.campaign_id = c.id AND t.status = 'Sent') as sent_count,
        (SELECT COUNT(*) FROM message_tasks t WHERE t.campaign_id = c.id AND t.status = 'Failed') as failed_count,
        c.total_targets
      FROM campaigns c
      ORDER BY c.created_at DESC
      LIMIT 10
    `);
    
    const items = rows.map((r: any) => ({
      id: r.id,
      title: r.title,
      tn_account_ids: (() => {
        try {
          return r.tn_account_ids ? JSON.parse(r.tn_account_ids) : [];
        } catch {
          return [];
        }
      })(),
      min_interval: r.min_interval,
      max_interval: r.max_interval,
      message_type: r.message_type || 'text',
      direction_mode: r.direction_mode || 'one_way',
      status: r.status,
      created_at: r.created_at,
      total_count: r.total_targets,
      sent_count: r.sent_count,
      failed_count: r.failed_count
    }));

    res.json(items);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  } finally {
    conn.release();
  }
});

router.post("/audit/privacy", async (req, res) => {
  const action = req.body?.action;
  const userId = req.headers["x-user-id"] ?? (req as any).user?.id ?? "anonymous";
  const tenantId = Number((req as any).tenantId ?? 1);
  const conn = await pool.getConnection();
  try {
    if (action) {
      await conn.query(
        "INSERT INTO audit_logs (user_id, action, details, tenant_id) VALUES (?, ?, ?, ?)",
        [userId, "privacy_audit", JSON.stringify({ mode: action }), tenantId]
      );
    }
    res.json({ success: true, mode: action });
  } catch (e: any) {
    console.error("[Audit] privacy audit_logs insert failed:", e);
    res.status(500).json({ error: "Failed to record audit" });
  } finally {
    conn.release();
  }
});

router.post("/privacy/status", async (req, res) => {
  const status = req.body?.status;
  const userId = req.headers["x-user-id"] ?? (req as any).user?.id ?? "anonymous";
  const tenantId = Number((req as any).tenantId ?? 1);
  const conn = await pool.getConnection();
  try {
    if (status) {
      await conn.query(
        "INSERT INTO audit_logs (user_id, action, details, tenant_id) VALUES (?, ?, ?, ?)",
        [userId, "privacy_consent", JSON.stringify({ status }), tenantId]
      );
    }
    res.json({ success: true });
  } catch (e: any) {
    console.error("[Privacy] audit_logs insert failed:", e);
    res.status(500).json({ error: "Failed to record privacy decision" });
  } finally {
    conn.release();
  }
});

export default router;
