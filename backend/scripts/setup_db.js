
import mysql from 'mysql2/promise';

async function main() {
    const config = {
        host: 'localhost',
        port: 3307,
        user: 'root',
        password: ''
    };

    console.log("Connecting to MariaDB...");
    const conn = await mysql.createConnection(config);

    console.log("Dropping Database massmail (clean slate)...");
    await conn.query("DROP DATABASE IF EXISTS massmail");
    
    console.log("Creating Database massmail...");
    await conn.query("CREATE DATABASE massmail");
    await conn.query("USE massmail");

    console.log("Creating Tables...");

    // users
    await conn.query(`
        CREATE TABLE IF NOT EXISTS users (
            id INT AUTO_INCREMENT PRIMARY KEY,
            username VARCHAR(255) NOT NULL UNIQUE,
            password VARCHAR(255) NOT NULL,
            role VARCHAR(50) DEFAULT 'user',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // accounts
    // tn_session_token_cipher needs to be BLOB for binary data
    await conn.query(`
        CREATE TABLE IF NOT EXISTS accounts (
            id INT AUTO_INCREMENT PRIMARY KEY,
            phone VARCHAR(255) UNIQUE,
            email VARCHAR(255),
            username VARCHAR(255),
            password VARCHAR(255),
            status VARCHAR(50) DEFAULT 'Ready',
            system_type VARCHAR(50),
            proxy_url VARCHAR(500),
            tn_client_id VARCHAR(255),
            tn_device_model VARCHAR(255),
            tn_os_version VARCHAR(255),
            tn_user_agent TEXT,
            tn_uuid VARCHAR(255),
            tn_vid VARCHAR(255),
            signature TEXT,
            app_version VARCHAR(50),
            brand VARCHAR(50),
            language VARCHAR(50),
            fp TEXT,
            tn_session_id VARCHAR(255),
            tn_session_token_cipher BLOB,
            last_used_at DATETIME,
            locked_by VARCHAR(255),
            locked_at DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME ON UPDATE CURRENT_TIMESTAMP
        )
    `);

    // campaigns
    await conn.query(`
        CREATE TABLE IF NOT EXISTS campaigns (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(255),
            content TEXT,
            media_url TEXT,
            total_targets INT DEFAULT 0,
            status VARCHAR(50) DEFAULT 'Pending',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // message_tasks
    await conn.query(`
        CREATE TABLE IF NOT EXISTS message_tasks (
            id INT AUTO_INCREMENT PRIMARY KEY,
            campaign_id INT,
            target_phone VARCHAR(255),
            content TEXT,
            media_url TEXT,
            status VARCHAR(50) DEFAULT 'Pending',
            account_id INT,
            error_code VARCHAR(50),
            error_message TEXT,
            processed_at DATETIME,
            completed_at DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
            FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL
        )
    `);

    // audit_logs
    await conn.query(`
        CREATE TABLE IF NOT EXISTS audit_logs (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id VARCHAR(255),
            action VARCHAR(255),
            details TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Insert default admin user
    try {
        await conn.query(`
            INSERT INTO users (username, password, role) VALUES ('admin', '123456', 'admin')
        `);
        console.log("Created admin user.");
    } catch (e) {
        // Ignore duplicate entry
    }

    console.log("Database setup complete.");
    await conn.end();
}

main().catch(console.error);
