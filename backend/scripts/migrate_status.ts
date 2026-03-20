
import 'dotenv/config';
import { pool } from '../src/shared/db';

async function main() {
  const conn = await pool.getConnection();
  try {
    console.log("Starting status migration...");

    // 1. Add progress to message_tasks
    try {
      await conn.query("ALTER TABLE message_tasks ADD COLUMN progress INT DEFAULT 0");
      console.log("Added progress to message_tasks");
    } catch (e: any) {
      if (e.code !== 'ER_DUP_FIELDNAME') console.log("progress skipped:", e.message);
    }

    // 2. Add error_msg to accounts
    try {
      await conn.query("ALTER TABLE accounts ADD COLUMN error_msg TEXT");
      console.log("Added error_msg to accounts");
    } catch (e: any) {
      if (e.code !== 'ER_DUP_FIELDNAME') console.log("error_msg skipped:", e.message);
    }

    console.log("Migration completed.");

  } catch (err) {
      console.error("Migration failed", err);
  } finally {
    conn.release();
    process.exit(0);
  }
}

main();
