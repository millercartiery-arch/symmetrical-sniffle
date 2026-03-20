-- ============================================================
-- 代理与账号绑定表结构
-- 执行顺序：1. accounts  2. proxies  3. account_proxy_bindings
-- 用法: mysql -u user -p database_name < create_proxy_tables.sql
-- 说明: 若 accounts 已存在可只建 2、3；表/索引已存在时会报错可忽略。
-- ============================================================

-- 1. accounts（TN 协议号表，若已有可跳过）
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
    tn_os_version VARCHAR(255),
    tn_user_agent TEXT,
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
    updated_at DATETIME ON UPDATE CURRENT_TIMESTAMP
);

-- 2. proxies（代理池表）
CREATE TABLE IF NOT EXISTS proxies (
    id INT AUTO_INCREMENT PRIMARY KEY,
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
);

-- 唯一约束：同一 endpoint 不重复
CREATE UNIQUE INDEX uniq_proxy_endpoint ON proxies (protocol, host, port, username);

-- 3. account_proxy_bindings（账号与代理绑定，带 Session 标识）
CREATE TABLE IF NOT EXISTS account_proxy_bindings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    account_id INT NOT NULL,
    proxy_id INT NOT NULL,
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
