
import mysql from 'mysql2/promise';

async function main() {
    const config = {
        host: 'localhost',
        port: 3307,
        user: 'root',
        password: '',
        database: 'massmail'
    };

    const conn = await mysql.createConnection(config);

    console.log("Creating contacts table...");
    await conn.query(`
        CREATE TABLE IF NOT EXISTS contacts (
            phone VARCHAR(20) PRIMARY KEY,
            name VARCHAR(100),
            pinned BOOLEAN DEFAULT FALSE,
            banned BOOLEAN DEFAULT FALSE,
            deleted BOOLEAN DEFAULT FALSE,
            unread_count INT DEFAULT 0,
            last_activity DATETIME,
            created_at DATETIME DEFAULT NOW(),
            updated_at DATETIME DEFAULT NOW() ON UPDATE NOW()
        )
    `);

    console.log("Populating contacts from message_tasks...");
    // Insert unique phones from tasks, ignore if exists
    await conn.query(`
        INSERT IGNORE INTO contacts (phone, last_activity)
        SELECT target_phone, MAX(created_at)
        FROM message_tasks
        GROUP BY target_phone
    `);

    console.log("Done.");
    await conn.end();
}

main().catch(console.error);
