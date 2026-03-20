
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

    // Get accounts
    const [accounts] = await conn.query("SELECT id FROM accounts WHERE status='Ready'");
    if (accounts.length === 0) {
        console.error("No ready accounts found.");
        await conn.end();
        return;
    }

    // Get tasks with NULL account_id
    const [tasks] = await conn.query("SELECT id FROM message_tasks WHERE account_id IS NULL");
    console.log(`Found ${tasks.length} tasks without account_id.`);

    for (const task of tasks) {
        const account = accounts[Math.floor(Math.random() * accounts.length)];
        await conn.query("UPDATE message_tasks SET account_id = ? WHERE id = ?", [account.id, task.id]);
    }

    console.log("Updated tasks.");
    await conn.end();
}

main().catch(console.error);
