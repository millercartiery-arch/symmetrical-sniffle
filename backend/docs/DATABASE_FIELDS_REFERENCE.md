# 数据库全部表与字段参考（本地可视化连接用）

连接信息来自 `backend/.env`：`DB_HOST`、`DB_PORT`、`DB_USER`、`DB_PASSWORD`、`DB_NAME`（默认 `massmail`）。

---

## 1. users（后台用户 / 子账号）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT AUTO_INCREMENT PRIMARY KEY | 主键 |
| username | VARCHAR(255) NOT NULL UNIQUE | 登录名 |
| password | VARCHAR(255) NOT NULL | 密码 |
| role | VARCHAR(50) DEFAULT 'user' | 角色：admin / user / operator |
| created_at | DATETIME | 创建时间 |
| quota_limit | INT DEFAULT 10 | 配额（操作员） |
| api_key | VARCHAR(255) NULL | API 密钥 |
| updated_at | DATETIME | 更新时间 |
| tenant_id | INT DEFAULT 1 | 租户 ID |

---

## 2. accounts（TN 协议号 / 发信账号）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT AUTO_INCREMENT PRIMARY KEY | 主键 |
| phone | VARCHAR(255) UNIQUE | 手机号 |
| email | VARCHAR(255) | 邮箱 |
| username | VARCHAR(255) | 用户名 |
| password | VARCHAR(255) | 密码 |
| status | VARCHAR(50) DEFAULT 'Ready' | Ready/Busy/Cooldown/ERROR/DISABLED 等 |
| system_type | VARCHAR(50) | 系统类型如 TextNow |
| proxy_url | VARCHAR(500) | 旧版代理 URL（可选，推荐用 account_proxy_bindings） |
| tn_client_id | VARCHAR(255) | TN 客户端 ID |
| tn_device_model | VARCHAR(255) | 设备型号 |
| tn_os | VARCHAR(64) NULL | 操作系统标识（可选） |
| tn_os_version | VARCHAR(255) | 系统版本 |
| tn_type | VARCHAR(64) NULL | TN 类型（可选） |
| tn_user_agent | TEXT | User-Agent |
| tn_uuid | VARCHAR(255) | 设备 UUID |
| tn_vid | VARCHAR(255) | 设备 VID |
| signature | TEXT | 签名 |
| app_version | VARCHAR(50) | 应用版本 |
| brand | VARCHAR(50) | 品牌 |
| language | VARCHAR(50) | 语言 |
| fp | TEXT | 指纹 |
| tn_session_id | VARCHAR(255) | TN 会话 ID |
| tn_session_token_cipher | BLOB | 会话 Token 密文 |
| last_used_at | DATETIME | 最后使用时间 |
| locked_by | VARCHAR(255) | 锁定者 |
| locked_at | DATETIME | 锁定时间 |
| created_at | DATETIME | 创建时间 |
| updated_at | DATETIME | 更新时间 |
| consecutive_errors | INT DEFAULT 0 | 连续错误次数 |
| error_msg | TEXT | 最近错误信息 |
| tenant_id | INT DEFAULT 1 | 租户 ID |

---

## 3. campaigns（活动 / 群发任务）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT AUTO_INCREMENT PRIMARY KEY | 主键 |
| name | VARCHAR(255) | 活动名称 |
| content | TEXT | 文本内容 |
| media_url | MEDIUMTEXT NULL | 媒体 URL |
| message_type | VARCHAR(20) DEFAULT 'text' | text/image/audio/video |
| direction_mode | VARCHAR(20) DEFAULT 'one_way' | one_way / two_way |
| min_interval | INT DEFAULT 300 | 最小间隔秒 |
| max_interval | INT DEFAULT 480 | 最大间隔秒 |
| tn_account_ids | TEXT NULL | 指定账号 ID 列表 JSON |
| total_targets | INT DEFAULT 0 | 目标数量 |
| status | VARCHAR(50) DEFAULT 'Pending' | 状态 |
| created_at | DATETIME | 创建时间 |
| tenant_id | INT DEFAULT 1 | 租户 ID |

---

## 4. message_tasks（单条发信任务）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT AUTO_INCREMENT PRIMARY KEY | 主键 |
| campaign_id | INT | 所属活动 → campaigns(id) |
| target_phone | VARCHAR(255) | 目标号码 |
| content | TEXT | 内容 |
| media_url | MEDIUMTEXT NULL | 媒体 URL |
| message_type | VARCHAR(20) DEFAULT 'text' | 消息类型 |
| direction_mode | VARCHAR(20) DEFAULT 'one_way' | 方向模式 |
| status | VARCHAR(50) DEFAULT 'Pending' | Pending/LOCKED/Processing/Sent/Failed 等 |
| account_id | INT NULL | 分配的发信账号 → accounts(id) |
| sub_account_id | BIGINT UNSIGNED NULL | 子账号（若使用子账号调度） |
| locked_at | TIMESTAMP NULL | 锁定时间 |
| scheduled_at | TIMESTAMP NULL | 计划发送时间 |
| retry_at | DATETIME NULL | 重试时间 |
| error_msg | TEXT NULL | 错误信息 |
| error_code | VARCHAR(50) | 错误码 |
| created_at | DATETIME | 创建时间 |
| updated_at | TIMESTAMP | 更新时间 |
| tenant_id | INT DEFAULT 1 | 租户 ID |

---

## 5. audit_logs（审计日志）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT AUTO_INCREMENT PRIMARY KEY | 主键 |
| user_id | VARCHAR(255) | 操作用户 |
| action | VARCHAR(255) | 动作 |
| details | TEXT | 详情 JSON |
| created_at | DATETIME | 创建时间 |
| tenant_id | INT DEFAULT 1 | 租户 ID |

---

## 6. proxies（代理池）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT AUTO_INCREMENT PRIMARY KEY | 主键 |
| protocol | VARCHAR(16) DEFAULT 'http' | 协议 |
| host | VARCHAR(255) NOT NULL | 主机 |
| port | INT NOT NULL | 端口 |
| username | VARCHAR(255) NULL | 认证用户名 |
| password | VARCHAR(255) NULL | 认证密码 |
| proxy_url_template | VARCHAR(1024) NULL | 代理 URL 模板（含 {session} 等） |
| provider | VARCHAR(128) NULL | 供应商 |
| status | VARCHAR(50) DEFAULT 'Unknown' | Active/Dead/Unknown 等 |
| is_active | TINYINT(1) DEFAULT 1 | 是否启用 |
| region | VARCHAR(128) NULL | 地区 |
| country | VARCHAR(128) NULL | 国家 |
| city | VARCHAR(128) NULL | 城市 |
| last_checked_at | DATETIME NULL | 最后探测时间 |
| last_latency_ms | INT NULL | 最后延迟 ms |
| last_alive | TINYINT(1) NULL | 最后是否存活 |
| created_at | DATETIME | 创建时间 |
| updated_at | DATETIME | 更新时间 |

唯一约束：`(protocol, host, port, username)`。

---

## 7. account_proxy_bindings（账号-代理绑定）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT AUTO_INCREMENT PRIMARY KEY | 主键 |
| account_id | INT NOT NULL | 账号 → accounts(id) ON DELETE CASCADE |
| proxy_id | INT NOT NULL | 代理 → proxies(id) ON DELETE CASCADE |
| session_key | VARCHAR(128) NOT NULL | 会话标识（保证同账号同出口） |
| is_primary | TINYINT(1) DEFAULT 1 | 是否主代理 |
| is_active | TINYINT(1) DEFAULT 1 | 是否启用 |
| created_at | DATETIME | 创建时间 |
| updated_at | DATETIME | 更新时间 |

唯一约束：`(account_id, proxy_id)`。

---

## 本地连接示例

- **数据库名**：与 `.env` 中 `DB_NAME` 一致（如 `massmail`）。
- **主机/端口**：`DB_HOST`、`DB_PORT`（如 localhost / 3306 或 3307）。
- **用户/密码**：`DB_USER`、`DB_PASSWORD`。

用 MySQL Workbench、DBeaver、Navicat 等新建连接，填上述参数即可可视化上述表与字段。
