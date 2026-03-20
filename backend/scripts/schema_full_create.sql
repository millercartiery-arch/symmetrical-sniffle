-- ============================================================
-- 一次性创建全部表（本地可视化 / 新环境）
--
-- 【DBeaver 里这样执行】
-- 1. 左侧连接里选中你的 MySQL，右键「SQL 编辑器」->「打开 SQL 脚本」选本文件；
-- 2. 顶部/连接处确保当前库是 massmail（没有则先执行下面一行再执行本脚本）：
--    CREATE DATABASE IF NOT EXISTS massmail;
-- 3. 在编辑器中全选本文件内容（从 -- 1. users 到末尾），Ctrl+Enter 或点「执行」。
--    不要执行 cd / mysql 等命令行，那是给终端用的。
--
-- 【命令行用法】
--    cd backend/scripts
--    mysql -u root -p -e "CREATE DATABASE IF NOT EXISTS massmail; USE massmail; SOURCE schema_full_create.sql;"
-- ============================================================

CREATE DATABASE IF NOT EXISTS massmail;
USE massmail;

-- 1. users
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(255) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    role VARCHAR(50) DEFAULT 'user',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    quota_limit INT DEFAULT 10 NOT NULL,
    api_key VARCHAR(255) NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    tenant_id INT DEFAULT 1 NOT NULL
);

-- 2. accounts（TN 协议号）
CREATE TABLE IF NOT EXISTS accounts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    phone VARCHAR(255) UNIQUE,
    email VARCHAR(255),
    username VARCHAR(255),
    password VARCHAR(255),
    status VARCHAR(50) DEFAULT 'Ready',
    system_type VARCHAR(50),
    proxy_url VARCHAR(500),
    tn_client_id VARCHAR(255),
    tn_device_model VARCHAR(255),
    tn_os VARCHAR(64) NULL,
    tn_os_version VARCHAR(255),
    tn_user_agent TEXT,
    tn_type VARCHAR(64) NULL,
    tn_uuid VARCHAR(255),
    tn_vid VARCHAR(255),
    signature TEXT,
    app_version VARCHAR(50),
    brand VARCHAR(50),
    language VARCHAR(50),
    fp TEXT,
    tn_session_id VARCHAR(255),
    tn_session_token_cipher BLOB,
    last_used_at DATETIME,
    locked_by VARCHAR(255),
    locked_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME ON UPDATE CURRENT_TIMESTAMP,
    consecutive_errors INT NOT NULL DEFAULT 0,
    error_msg TEXT,
    rate_limit INT DEFAULT 300,
    rate_window_sec INT DEFAULT 300,
    rate_counter INT DEFAULT 0,
    rate_reset_at DATETIME NULL,
    tenant_id INT DEFAULT 1 NOT NULL
);

-- 3. campaigns
CREATE TABLE IF NOT EXISTS campaigns (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255),
    content TEXT,
    media_url MEDIUMTEXT NULL,
    message_type VARCHAR(20) NOT NULL DEFAULT 'text',
    direction_mode VARCHAR(20) NOT NULL DEFAULT 'one_way',
    min_interval INT NOT NULL DEFAULT 300,
    max_interval INT NOT NULL DEFAULT 480,
    tn_account_ids TEXT NULL,
    total_targets INT DEFAULT 0,
    status VARCHAR(50) DEFAULT 'Pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    tenant_id INT DEFAULT 1 NOT NULL
);

-- 4. message_tasks
CREATE TABLE IF NOT EXISTS message_tasks (
    id INT AUTO_INCREMENT PRIMARY KEY,
    campaign_id INT,
    target_phone VARCHAR(255),
    content TEXT,
    media_url MEDIUMTEXT NULL,
    message_type VARCHAR(20) NOT NULL DEFAULT 'text',
    direction_mode VARCHAR(20) NOT NULL DEFAULT 'one_way',
    status VARCHAR(50) DEFAULT 'Pending',
    account_id INT,
    sub_account_id BIGINT UNSIGNED NULL,
    locked_at TIMESTAMP NULL,
    scheduled_at TIMESTAMP NULL,
    retry_at DATETIME NULL,
    error_msg TEXT NULL,
    error_code VARCHAR(50),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    tenant_id INT NOT NULL DEFAULT 1,
    FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL
);

-- 5. contacts（会话/联系人，inbound 与 chat 使用）
CREATE TABLE IF NOT EXISTS contacts (
    phone VARCHAR(20) PRIMARY KEY,
    name VARCHAR(100) NULL,
    pinned TINYINT(1) DEFAULT 0,
    banned TINYINT(1) DEFAULT 0,
    deleted TINYINT(1) DEFAULT 0,
    unread_count INT DEFAULT 0,
    last_activity DATETIME NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 6. audit_logs
CREATE TABLE IF NOT EXISTS audit_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id VARCHAR(255),
    action VARCHAR(255),
    details TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    tenant_id INT DEFAULT 1 NOT NULL
);

-- 7. proxies（与 backend ensureProxySchema 及 GET /proxies 一致；id 为 BIGINT UNSIGNED 与 proxy_audit.proxy_id 兼容）
CREATE TABLE IF NOT EXISTS proxies (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    protocol VARCHAR(16) NOT NULL DEFAULT 'http',
    host VARCHAR(255) NOT NULL,
    port INT NOT NULL,
    username VARCHAR(255) NULL,
    password VARCHAR(255) NULL,
    auth_pass_enc VARCHAR(512) NULL,
    proxy_url_template VARCHAR(1024) NULL,
    provider VARCHAR(128) NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'Unknown',
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    region VARCHAR(128) NULL,
    country VARCHAR(128) NULL,
    city VARCHAR(128) NULL,
    description VARCHAR(255) NULL,
    tags JSON NULL,
    weight TINYINT UNSIGNED NOT NULL DEFAULT 1,
    last_checked_at DATETIME NULL,
    last_latency_ms INT NULL,
    last_alive TINYINT(1) NULL,
    last_success_at DATETIME NULL,
    last_error_msg TEXT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX uniq_proxy_endpoint ON proxies (protocol, host, port, username);

-- 7a. proxy_audit（代理操作审计；proxy_id 与 proxies.id 同为 BIGINT UNSIGNED）
CREATE TABLE IF NOT EXISTS proxy_audit (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    proxy_id BIGINT UNSIGNED NULL,
    action VARCHAR(32) NOT NULL,
    operator_id VARCHAR(64) NULL,
    detail JSON NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_proxy_audit_proxy (proxy_id),
    INDEX idx_proxy_audit_operator (operator_id),
    CONSTRAINT fk_proxy_audit_proxy FOREIGN KEY (proxy_id) REFERENCES proxies(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 7b. credentials（全局凭证，仅运维/安全维护；cipher_version 用于密钥轮换）
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 8. card_keys（卡密：授权+配额，不存密码）
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 9. sub_accounts（子账号：调度粒度，关联 credential + card_key）
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
    CONSTRAINT fk_sub_accounts_card_key FOREIGN KEY (card_key_id) REFERENCES card_keys(id) ON DELETE SET NULL,
    CONSTRAINT fk_sub_accounts_proxy FOREIGN KEY (proxy_id) REFERENCES proxies(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 10. account_proxy_bindings
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
);

-- 执行到此处若无报错，说明建表已完成。下面两条用于在结果集中看到明确提示：
SELECT 'schema_full_create 执行完成（含 credentials / card_keys / sub_accounts）' AS 执行结果;
SHOW TABLES;
