/**
 * 一次性执行：强制释放 LOCKED/Processing 与 Busy + 租户对齐为 subop_20260316_1
 *
 * 用法：
 *   - 本机（连本机 DB）：在项目根目录执行 node backend/scripts/run_reset_and_tenant.cjs
 *   - 服务器：把 backend 拷到服务器后，在服务器上设置好 .env（或 DB_* 环境变量），
 *     在 backend 目录执行 node scripts/run_reset_and_tenant.cjs
 *   - 或直接在服务器 MySQL 中执行 backend/scripts/reset_stuck_tasks_and_locks.sql（含强制释放 + 租户对齐）
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const mysql = require("mysql2/promise");

const DB = {
  host: process.env.DB_HOST || "localhost",
  port: +(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "massmail",
};

async function main() {
  const conn = await mysql.createConnection(DB);
  try {
    console.log("1. 强制释放：任务 LOCKED/Processing -> Pending ...");
    const [r1] = await conn.execute(
      `UPDATE message_tasks SET status = 'Pending', locked_at = NULL, account_id = NULL WHERE status IN ('LOCKED', 'Processing')`
    );
    console.log("   message_tasks 影响行数:", r1.affectedRows);

    console.log("2. 强制释放：账号 Busy -> Ready ...");
    const [r2] = await conn.execute(
      `UPDATE accounts SET status = 'Ready', locked_at = NULL, locked_by = NULL WHERE status = 'Busy'`
    );
    console.log("   accounts 影响行数:", r2.affectedRows);

    console.log("3. 租户对齐：取 subop_20260316_1 的 tenant_id ...");
    const [rows] = await conn.execute(
      `SELECT tenant_id FROM users WHERE username = 'subop_20260316_1' LIMIT 1`
    );
    const tid = rows[0]?.tenant_id;
    if (tid == null) {
      console.warn("   未找到用户 subop_20260316_1，跳过租户更新。若需对齐请先创建该用户。");
    } else {
      const [r3] = await conn.execute(`UPDATE message_tasks SET tenant_id = ?`, [tid]);
      const [r4] = await conn.execute(`UPDATE campaigns SET tenant_id = ?`, [tid]);
      console.log("   tenant_id =", tid, "| message_tasks 更新:", r3.affectedRows, "| campaigns 更新:", r4.affectedRows);
    }

    console.log("4. 当前状态分布:");
    const [t] = await conn.execute(`SELECT status, COUNT(*) AS cnt FROM message_tasks GROUP BY status`);
    const [a] = await conn.execute(`SELECT status, COUNT(*) AS cnt FROM accounts GROUP BY status`);
    console.log("   message_tasks:", t);
    console.log("   accounts:", a);
    console.log("\n完成。请刷新面板查看任务是否进入队列。");
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
