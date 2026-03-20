
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
    
    console.log("Tables:");
    const [tables] = await conn.query("SHOW TABLES");
    console.log(tables.map(t => Object.values(t)[0]));

    console.log("\nmessage_tasks columns:");
    const [cols] = await conn.query("DESCRIBE message_tasks");
    console.log(cols.map(c => c.Field));

    await conn.end();
}

main().catch(console.error);
