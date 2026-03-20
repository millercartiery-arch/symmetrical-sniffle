
import 'dotenv/config';
import { pool } from '../src/shared/db';

async function main() {
  const [rows] = await pool.query('DESCRIBE accounts');
  console.log(rows);
  pool.end();
}

main();
