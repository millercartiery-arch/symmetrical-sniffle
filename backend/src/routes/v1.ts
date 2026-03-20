import express from "express";
import { pool } from "../shared/db.js";

const router = express.Router();

const DEFAULT_FIELDS = ["accountId", "username", "password", "deviceId", "remark", "expireAt"];

/**
 * GET /api/v1/fields?type=<plugin>
 * 返回插件支持的导出字段列表
 */
router.get("/fields", (req, res) => {
  const type = (req.query.type as string) || "";
  res.json({ fields: [...DEFAULT_FIELDS] });
});

/**
 * GET /api/v1/export?type=&filter=&fields=
 * 返回 text/csv 文件流，带 CORS 头供扩展/跨域使用
 */
router.get("/export", async (req, res) => {
  const type = (req.query.type as string) || "";
  const filter = (req.query.filter as string) || "";
  const fieldsParam = req.query.fields as string | string[] | undefined;
  const tenantId = (req as any).tenantId ?? 1;

  const fields = Array.isArray(fieldsParam)
    ? fieldsParam
    : typeof fieldsParam === "string"
      ? fieldsParam.split(",").map((s) => s.trim()).filter(Boolean)
      : DEFAULT_FIELDS;
  if (fields.length === 0) {
    return res.status(400).json({ error: "fields required or use default" });
  }

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Disposition", "attachment; filename=export.csv");

  const conn = await pool.getConnection();
  try {
    let whereClause = "WHERE tenant_id = ?";
    const queryParams: any[] = [tenantId];
    if (filter) {
      whereClause += " AND (username LIKE ? OR phone LIKE ? OR email LIKE ?)";
      const like = `%${filter}%`;
      queryParams.push(like, like, like);
    }

    const [rows]: any = await conn.query(
      `SELECT id, username, password, tn_device_model AS deviceId
       FROM accounts ${whereClause}
       ORDER BY id`,
      queryParams
    );

    const toCol = (key: string): string => {
      const map: Record<string, string> = {
        accountId: "id",
        username: "username",
        password: "password",
        deviceId: "deviceId",
        remark: "remark",
        expireAt: "expireAt",
      };
      return map[key] || key;
    };

    const escapeCsv = (v: unknown): string => {
      const s = v == null ? "" : String(v);
      if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };

    const header = fields.map(escapeCsv).join(",");
    res.write("\uFEFF"); // BOM for Excel UTF-8
    res.write(header + "\n");

    for (const row of rows) {
      const record: Record<string, unknown> = {
        id: row.id,
        username: row.username ?? "",
        password: row.password ?? "",
        deviceId: row.deviceId ?? "",
        remark: "",
        expireAt: "",
      };
      const line = fields.map((f) => escapeCsv(record[toCol(f)] ?? "")).join(",");
      res.write(line + "\n");
    }
    res.end();
  } catch (err: any) {
    res.removeHeader("Content-Disposition");
    res.setHeader("Content-Type", "application/json");
    res.status(500).json({ error: "Export failed", detail: String(err?.message || err) });
  } finally {
    conn.release();
  }
});

export default router;
