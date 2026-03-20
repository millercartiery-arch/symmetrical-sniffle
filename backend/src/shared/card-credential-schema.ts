/**
 * 卡密 + 全局凭证 + 子账号 表结构
 * credentials: 全局登录凭证（username, password_hash / password_cipher）
 * card_keys: 卡密（授权+配额，不存密码）
 * sub_accounts: 子账号（调度粒度，关联 credential_id + card_key_id）
 */
import { pool } from './db.js';
import { ensureProxySchema } from './proxy-schema.js';

let schemaReady = false;

export async function ensureCardCredentialSchema(conn?: any) {
  if (schemaReady) return;
  const connection = conn || (await pool.getConnection());
  const shouldRelease = !conn;
  try {
    await ensureProxySchema(connection);
    await connection.query(`
      CREATE TABLE IF NOT EXISTS credentials (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        type VARCHAR(32) NOT NULL,
        username VARCHAR(64) NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        password_cipher BLOB NULL,
        cipher_version TINYINT UNSIGNED NOT NULL DEFAULT 1,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        KEY idx_credentials_type (type)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    try {
      await connection.query('ALTER TABLE credentials ADD COLUMN cipher_version TINYINT UNSIGNED NOT NULL DEFAULT 1');
    } catch (e: any) {
      if (e?.code !== 'ER_DUP_FIELDNAME') throw e;
    }

    await connection.query(`
      CREATE TABLE IF NOT EXISTS card_keys (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        code_enc VARCHAR(512) NOT NULL,
        type VARCHAR(32) NOT NULL,
        status VARCHAR(32) NOT NULL DEFAULT 'active',
        max_use INT UNSIGNED NULL,
        use_count INT UNSIGNED NOT NULL DEFAULT 0,
        valid_from DATETIME NULL,
        valid_to DATETIME NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_card_keys_code (code_enc),
        KEY idx_card_keys_type_status (type, status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS sub_accounts (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        card_key_id BIGINT UNSIGNED NULL,
        credential_id BIGINT UNSIGNED NOT NULL,
        region VARCHAR(64) NULL,
        weight TINYINT UNSIGNED NOT NULL DEFAULT 1,
        proxy_id BIGINT UNSIGNED NULL,
        rate_limit INT UNSIGNED NOT NULL DEFAULT 300,
        rate_counter INT UNSIGNED NOT NULL DEFAULT 0,
        rate_reset_at DATETIME NULL,
        rate_window_sec INT UNSIGNED NOT NULL DEFAULT 300,
        status VARCHAR(32) NOT NULL DEFAULT 'ready',
        is_busy TINYINT(1) NOT NULL DEFAULT 0,
        enabled TINYINT(1) NOT NULL DEFAULT 1,
        locked_at DATETIME NULL,
        locked_by VARCHAR(255) NULL,
        tenant_id INT NOT NULL DEFAULT 1,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        KEY idx_sub_accounts_credential (credential_id),
        KEY idx_sub_accounts_status_busy (status, is_busy, enabled),
        KEY idx_sub_accounts_ready (status, enabled, is_busy, weight),
        KEY idx_sub_accounts_card_key (card_key_id),
        KEY idx_sub_accounts_tenant (tenant_id),
        CONSTRAINT fk_sub_accounts_credential FOREIGN KEY (credential_id) REFERENCES credentials(id) ON DELETE RESTRICT,
        CONSTRAINT fk_sub_accounts_card_key FOREIGN KEY (card_key_id) REFERENCES card_keys(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    try {
      await connection.query('ALTER TABLE sub_accounts ADD COLUMN rate_window_sec INT UNSIGNED NOT NULL DEFAULT 300');
    } catch (e: any) {
      if (e?.code !== 'ER_DUP_FIELDNAME') throw e;
    }
    // 兼容老库：历史字段可能是 BIGINT，这里统一成与 proxies.id 一致的 INT
    await connection.query('ALTER TABLE sub_accounts MODIFY COLUMN proxy_id INT NULL');
    try {
      await connection.query('CREATE INDEX idx_sub_accounts_ready ON sub_accounts (status, enabled, is_busy, weight)');
    } catch (e: any) {
      if (e?.code !== 'ER_DUP_KEYNAME') throw e;
    }
    try {
      await connection.query(
        'ALTER TABLE sub_accounts ADD CONSTRAINT fk_sub_accounts_proxy FOREIGN KEY (proxy_id) REFERENCES proxies(id) ON DELETE SET NULL'
      );
    } catch (e: any) {
      const errno = Number(e?.errno);
      const code = String(e?.code || '');
      if (
        code !== 'ER_DUP_KEYNAME' &&
        code !== 'ER_FK_DUP_NAME' &&
        code !== 'ER_CANT_CREATE_TABLE' &&
        code !== 'ER_FK_INCOMPATIBLE_COLUMNS' &&
        errno !== 1825 &&
        errno !== 3780
      ) {
        throw e;
      }
    }

    schemaReady = true;
  } finally {
    if (shouldRelease) connection.release();
  }
}
