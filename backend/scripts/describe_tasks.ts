
import 'dotenv/config';
import { pool } from '../src/shared/db';

async function main() {
  const [rows] = await pool.query('DESCRIBE message_tasks');
  console.log(rows);
  pool.end();
}

main();
