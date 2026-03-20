import { pool } from "./db.js";

const ER_LOCK_DEADLOCK = "ER_LOCK_DEADLOCK";
const DEADLOCK_CODE = 1213;
const MAX_SCHEMA_RETRIES = 3;
const RETRY_DELAY_MS = 200;

function isDeadlock(err: any): boolean {
  return err?.code === ER_LOCK_DEADLOCK || err?.errno === DEADLOCK_CODE;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function queryWithDeadlockRetry(connection: any, sql: string, retries = MAX_SCHEMA_RETRIES): Promise<void> {
  for (let i = 0; i <= retries; i++) {
    try {
      await connection.query(sql);
      return;
    } catch (err: any) {
      if (i < retries && isDeadlock(err)) {
        await sleep(RETRY_DELAY_MS * (i + 1));
        continue;
      }
      throw err;
    }
  }
}

let proxySchemaReady = false;

const SCHEMA_LOCK_NAME = "massmail_ensure_proxy_schema";
const SCHEMA_LOCK_TIMEOUT_SEC = 45;

export async function ensureProxySchema(conn?: any) {
  if (proxySchemaReady) return;

  const connection = conn || (await pool.getConnection());
  const shouldRelease = !conn;
  try {
    const [lockRows] = await connection.query("SELECT GET_LOCK(?, ?) AS v", [
      SCHEMA_LOCK_NAME,
      SCHEMA_LOCK_TIMEOUT_SEC,
    ]);
    const gotLock = (lockRows as { v: number }[])?.[0]?.v === 1;
    if (!gotLock) return;
    try {
      await runSchema(connection);
    } finally {
      await connection.query("SELECT RELEASE_LOCK(?)", [SCHEMA_LOCK_NAME]);
    }
    proxySchemaReady = true;
  } finally {
    if (shouldRelease) {
      connection.release();
    }
  }
}

async function runSchema(connection: any): Promise<void> {
  // proxies.id 使用 BIGINT UNSIGNED，与 proxy_audit.proxy_id 一致，避免外键 "column are incompatible"
  await connection.query(`
      CREATE TABLE IF NOT EXISTS proxies (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        protocol VARCHAR(16) NOT NULL DEFAULT 'http',
        host VARCHAR(255) NOT NULL,
        port INT NOT NULL,
        username VARCHAR(255) NULL,
        password VARCHAR(255) NULL,
        proxy_url_template VARCHAR(1024) NULL,
        provider VARCHAR(128) NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'Unknown',
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        region VARCHAR(128) NULL,
        country VARCHAR(128) NULL,
        city VARCHAR(128) NULL,
        last_checked_at DATETIME NULL,
        last_latency_ms INT NULL,
        last_alive TINYINT(1) NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    const alterStatements = [
      "ALTER TABLE proxies ADD COLUMN proxy_url_template VARCHAR(1024) NULL",
      "ALTER TABLE proxies ADD COLUMN provider VARCHAR(128) NULL",
      "ALTER TABLE proxies ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1",
      "ALTER TABLE proxies ADD COLUMN region VARCHAR(128) NULL",
      "ALTER TABLE proxies ADD COLUMN country VARCHAR(128) NULL",
      "ALTER TABLE proxies ADD COLUMN city VARCHAR(128) NULL",
      "ALTER TABLE proxies ADD COLUMN last_latency_ms INT NULL",
      "ALTER TABLE proxies ADD COLUMN last_alive TINYINT(1) NULL",
      "ALTER TABLE proxies ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP",
      "ALTER TABLE proxies ADD COLUMN description VARCHAR(255) NULL",
      "ALTER TABLE proxies ADD COLUMN tags JSON NULL",
      "ALTER TABLE proxies ADD COLUMN weight TINYINT UNSIGNED NOT NULL DEFAULT 1",
      "ALTER TABLE proxies ADD COLUMN last_success_at DATETIME NULL",
      "ALTER TABLE proxies ADD COLUMN last_error_msg TEXT NULL",
      "ALTER TABLE proxies ADD COLUMN auth_pass_enc VARCHAR(512) NULL",
    ];

    for (const sql of alterStatements) {
      try {
        await queryWithDeadlockRetry(connection, sql);
      } catch (error: any) {
        if (error?.code !== "ER_DUP_FIELDNAME") throw error;
      }
    }

    try {
      await queryWithDeadlockRetry(connection, "CREATE UNIQUE INDEX uniq_proxy_endpoint ON proxies (protocol, host, port, username)");
    } catch (error: any) {
      if (error?.code !== "ER_DUP_KEYNAME") throw error;
    }

    await connection.query(`
      CREATE TABLE IF NOT EXISTS account_proxy_bindings (
        id INT AUTO_INCREMENT PRIMARY KEY,
        account_id INT NOT NULL,
        proxy_id BIGINT UNSIGNED NOT NULL,
        session_key VARCHAR(128) NOT NULL,
        is_primary TINYINT(1) NOT NULL DEFAULT 1,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_account_proxy_binding (account_id, proxy_id),
        KEY idx_apb_account (account_id, is_active, is_primary),
        KEY idx_apb_proxy (proxy_id, is_active),
        CONSTRAINT fk_apb_account FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
        CONSTRAINT fk_apb_proxy FOREIGN KEY (proxy_id) REFERENCES proxies(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    const bindingAlterStatements = [
      "ALTER TABLE account_proxy_bindings ADD COLUMN session_key VARCHAR(128) NOT NULL DEFAULT 'default'",
      "ALTER TABLE account_proxy_bindings ADD COLUMN is_primary TINYINT(1) NOT NULL DEFAULT 1",
      "ALTER TABLE account_proxy_bindings ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1",
      "ALTER TABLE account_proxy_bindings ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP",
    ];
    for (const sql of bindingAlterStatements) {
      try {
        await queryWithDeadlockRetry(connection, sql);
      } catch (error: any) {
        if (error?.code !== "ER_DUP_FIELDNAME") throw error;
      }
    }

    try {
      await queryWithDeadlockRetry(connection, "CREATE UNIQUE INDEX uniq_account_proxy_binding ON account_proxy_bindings (account_id, proxy_id)");
    } catch (error: any) {
      if (error?.code !== "ER_DUP_KEYNAME") throw error;
    }

    try {
      await queryWithDeadlockRetry(connection, "CREATE INDEX idx_apb_account ON account_proxy_bindings (account_id, is_active, is_primary)");
    } catch (error: any) {
      if (error?.code !== "ER_DUP_KEYNAME") throw error;
    }

    try {
      await queryWithDeadlockRetry(connection, "CREATE INDEX idx_apb_proxy ON account_proxy_bindings (proxy_id, is_active)");
    } catch (error: any) {
      if (error?.code !== "ER_DUP_KEYNAME") throw error;
    }

    const fkStatements = [
      "ALTER TABLE account_proxy_bindings ADD CONSTRAINT fk_apb_account FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE",
      "ALTER TABLE account_proxy_bindings ADD CONSTRAINT fk_apb_proxy FOREIGN KEY (proxy_id) REFERENCES proxies(id) ON DELETE CASCADE",
    ];
    for (const sql of fkStatements) {
      try {
        await queryWithDeadlockRetry(connection, sql);
      } catch (error: any) {
        // ER_DUP_KEYNAME (1061)：外键/索引已存在；ER_FK_DUP_NAME：重复约束名
        if (error?.code !== "ER_DUP_KEYNAME" && error?.code !== "ER_FK_DUP_NAME" && error?.code !== "ER_CANT_CREATE_TABLE") throw error;
      }
    }

    // proxy_id 与 proxies.id 统一为 BIGINT UNSIGNED，避免外键 "Referencing column ... are incompatible"
    await connection.query(`
      CREATE TABLE IF NOT EXISTS proxy_audit (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        proxy_id BIGINT UNSIGNED NULL,
        action VARCHAR(32) NOT NULL,
        operator_id VARCHAR(64) NULL,
        detail JSON NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_proxy_audit_proxy (proxy_id),
        INDEX idx_proxy_audit_operator (operator_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    try {
      await queryWithDeadlockRetry(connection,
        'ALTER TABLE proxy_audit ADD CONSTRAINT fk_proxy_audit_proxy FOREIGN KEY (proxy_id) REFERENCES proxies(id) ON DELETE SET NULL ON UPDATE CASCADE'
      );
    } catch (e: any) {
      // 允许旧库兼容：外键已存在/重复命名/不存在的主表/列类型不兼容（常见 3780）都不应阻断服务启动
      const errno = Number(e?.errno);
      const code = String(e?.code || '');
      if (
        code !== 'ER_DUP_KEYNAME' &&
        code !== 'ER_FK_DUP_NAME' &&
        code !== 'ER_CANT_CREATE_TABLE' &&
        code !== 'ER_FK_INCOMPATIBLE_COLUMNS' &&
        errno !== 1825 && // Cannot add foreign key constraint (generic)
        errno !== 3780 // Referencing column ... are incompatible
      ) {
        console.error('❌ 添加 proxy_audit 外键失败 →', e?.sqlMessage, e?.code, e?.stack ?? e);
        throw e;
      }
    }
    // 兼容老 MySQL：不使用 "IF NOT EXISTS"，重复索引用 ER_DUP_KEYNAME 忽略
    const proxyIndexStatements = [
      'CREATE INDEX idx_proxies_is_active ON proxies (is_active)',
      'CREATE INDEX idx_proxies_region ON proxies (region)',
      'CREATE INDEX idx_proxies_protocol ON proxies (protocol)',
    ];
    for (const sql of proxyIndexStatements) {
      try {
        await queryWithDeadlockRetry(connection, sql);
      } catch (e: any) {
        if (e?.code !== 'ER_DUP_KEYNAME') {
          console.error('❌ 创建 proxy 索引失败 →', e?.sqlMessage, e?.code, e?.stack ?? e);
          throw e;
        }
      }
    }
}

