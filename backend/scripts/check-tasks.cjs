const mysql = require('mysql2/promise');

async function run() {
  const config = {
    host: process.env.DB_HOST || 'localhost',
    port: +(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD ?? '',
    database: process.env.DB_NAME || 'massmail'
  };

  try {
    const conn = await mysql.createConnection(config);
    const [rows] = await conn.query(
      `SELECT id, status, error_code, error_msg, created_at, updated_at 
       FROM message_tasks 
       ORDER BY id DESC 
       LIMIT 10`
    );
    console.log('Recent tasks:', JSON.stringify(rows, null, 2));

    const [pending] = await conn.query("SELECT COUNT(*) as count FROM message_tasks WHERE status = 'Pending'");
    console.log('Pending tasks count:', pending[0].count);

    await conn.end();
  } catch (err) {
    console.error('Error:', err);
  }
}

run();
