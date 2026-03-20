#!/usr/bin/env node
/**
 * 8️⃣ 下一步建议：自动 Phone Normalization Migration
 * 将 message_tasks.target_phone、contacts.phone 统一为仅数字，便于与 normalizePhone 查询一致。
 * 使用：npm run migrate:normalize-phone（需在 backend 目录，.env 已配置）
 * 要求：MySQL 8.0+（使用 REGEXP_REPLACE）；更早版本可改为应用层逐行 UPDATE。
 */
import { config } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import mysql from "mysql2/promise";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, "..", ".env") });

async function main() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || "localhost",
    port: +(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "massmail",
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || "massmail",
  });

  try {
    // MySQL 8.0: REGEXP_REPLACE(expr, pat, repl)
    const conn = await pool.getConnection();
    try {
      const [msgResult] = await conn.execute(
        `UPDATE message_tasks SET target_phone = REGEXP_REPLACE(target_phone, '[^0-9]', '') WHERE target_phone REGEXP '[^0-9]'`
      );
      const [contactResult] = await conn.execute(
        `UPDATE contacts SET phone = REGEXP_REPLACE(phone, '[^0-9]', '') WHERE phone REGEXP '[^0-9]'`
      );
      const msgRows = msgResult?.affectedRows ?? 0;
      const contactRows = contactResult?.affectedRows ?? 0;
      console.log("migrate:normalize-phone done. message_tasks:", msgRows, "contacts:", contactRows);
    } finally {
      conn.release();
    }
  } catch (e) {
    if (e?.code === "ER_NO_SUCH_TABLE" || e?.message?.includes("REGEXP_REPLACE")) {
      console.error("MySQL 8.0+ required for REGEXP_REPLACE, or run a custom migration. Error:", e?.message);
    } else {
      console.error("migrate:normalize-phone failed:", e);
    }
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
