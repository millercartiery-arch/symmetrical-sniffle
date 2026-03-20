
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

    try {
        const [rows] = await conn.query("SHOW TABLES");
        console.log("Tables:", rows.map((r: any) => Object.values(r)[0]));
        
        // Check if proxies table exists
        const [proxies] = await conn.query("SHOW TABLES LIKE 'proxies'");
        if (proxies.length === 0) {
            console.log("Creating proxies table...");
            await conn.query(`
                CREATE TABLE IF NOT EXISTS proxies (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    protocol VARCHAR(10) DEFAULT 'http',
                    host VARCHAR(255) NOT NULL,
                    port INT NOT NULL,
                    username VARCHAR(255),
                    password VARCHAR(255),
                    status ENUM('Active', 'Dead', 'Checking') DEFAULT 'Active',
                    last_checked_at DATETIME,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    UNIQUE KEY unique_proxy (host, port)
                )
            `);
            console.log("Proxies table created.");
        } else {
            console.log("Proxies table already exists.");
        }
    } catch (e) {
        console.error(e);
    } finally {
        await conn.end();
    }
}

main();
