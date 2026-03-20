import mysql from 'mysql2/promise';

export const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: +(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'massmail',
  password: process.env.DB_PASSWORD, 
  database: process.env.DB_NAME || 'massmail',
  waitForConnections: true,
  connectionLimit: 50, // Increased from 10 to handle more concurrent requests
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
  namedPlaceholders: true,
  // Timeouts to prevent hanging connections
  connectTimeout: 10000, // 10s
});
