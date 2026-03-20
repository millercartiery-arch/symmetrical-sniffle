
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
    
    console.log("\naccounts columns:");
    const [cols] = await conn.query("DESCRIBE accounts");
    console.log(cols.map(c => `${c.Field} (${c.Type})`));

    await conn.end();
}

main().catch(console.error);
