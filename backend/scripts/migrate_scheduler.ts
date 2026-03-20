
import 'dotenv/config';
import { pool } from '../src/shared/db';

async function main() {
  const conn = await pool.getConnection();
  try {
    console.log("Starting migration...");

    // 1. tenant_id
    try {
      await conn.query("ALTER TABLE message_tasks ADD COLUMN tenant_id INT NOT NULL DEFAULT 1");
      console.log("Added tenant_id");
    } catch (e: any) {
      if (e.code !== 'ER_DUP_FIELDNAME') console.log("tenant_id skipped:", e.message);
    }
    
    // 2. status
    try {
      await conn.query("ALTER TABLE message_tasks ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'PENDING'");
      console.log("Added status");
    } catch (e: any) {
      if (e.code !== 'ER_DUP_FIELDNAME') console.log("status skipped:", e.message);
    }
    
    // 3. locked_at
    try {
      await conn.query("ALTER TABLE message_tasks ADD COLUMN locked_at TIMESTAMP NULL");
      console.log("Added locked_at");
    } catch (e: any) {
      if (e.code !== 'ER_DUP_FIELDNAME') console.log("locked_at skipped:", e.message);
    }

    // 4. sent_at
    try {
      await conn.query("ALTER TABLE message_tasks ADD COLUMN sent_at TIMESTAMP NULL");
      console.log("Added sent_at");
    } catch (e: any) {
       if (e.code !== 'ER_DUP_FIELDNAME') console.log("sent_at skipped:", e.message);
    }

    // 5. error_msg
    try {
       await conn.query("ALTER TABLE message_tasks ADD COLUMN error_msg TEXT");
       console.log("Added error_msg");
    } catch (e: any) {
       if (e.code !== 'ER_DUP_FIELDNAME') console.log("error_msg skipped:", e.message);
    }

    // 6. scheduled_at
    try {
       await conn.query("ALTER TABLE message_tasks ADD COLUMN scheduled_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP");
       console.log("Added scheduled_at");
    } catch (e: any) {
       if (e.code !== 'ER_DUP_FIELDNAME') console.log("scheduled_at skipped:", e.message);
    }
    
    // Indexes
    try {
        await conn.query("CREATE INDEX idx_tasks_tenant_status ON message_tasks (tenant_id, status)");
        console.log("Added idx_tasks_tenant_status");
    } catch (e: any) {
        // 1061 = Duplicate key name
        if (e.code !== 'ER_DUP_KEYNAME' && e.errno !== 1061) console.log("Index idx_tasks_tenant_status skipped:", e.message);
    }

    try {
        await conn.query("CREATE INDEX idx_tasks_scheduled ON message_tasks (scheduled_at)");
        console.log("Added idx_tasks_scheduled");
    } catch (e: any) {
         if (e.code !== 'ER_DUP_KEYNAME' && e.errno !== 1061) console.log("Index idx_tasks_scheduled skipped:", e.message);
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
