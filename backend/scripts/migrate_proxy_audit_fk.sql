-- 修复 proxy_audit.proxy_id 与 proxies.id 类型不一致导致的外键错误（修复文件2）
-- 错误信息: Referencing column 'proxy_id' and referenced column 'id' in foreign key
--           constraint 'fk_proxy_audit_proxy' are incompatible.
-- 方案: 将两列统一为 BIGINT UNSIGNED（推荐，自增主键语义正确）。
-- 用法: 在 massmail 库下执行。执行前建议备份: mysqldump -u root -p massmail > backup_$(date +%F).sql
-- 可选：检查是否有负数（若有需先处理）: SELECT id FROM proxies WHERE id < 0 LIMIT 1;
-- 若 account_proxy_bindings 或 sub_accounts 表尚未创建，可暂时注释步骤 2–3、6–7 及对应的 ADD CONSTRAINT，仅执行 proxy_audit 与 proxies 部分。

USE massmail;

SET @old_fk_checks = @@FOREIGN_KEY_CHECKS;
SET FOREIGN_KEY_CHECKS = 0;

-- 1) 删除 proxy_audit 外键（若存在）
SELECT COUNT(*) INTO @fk_audit
FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'proxy_audit' AND CONSTRAINT_NAME = 'fk_proxy_audit_proxy';
SET @drop_audit = IF(@fk_audit > 0, 'ALTER TABLE proxy_audit DROP FOREIGN KEY fk_proxy_audit_proxy', 'SELECT 1 AS _noop');
PREPARE stmt FROM @drop_audit;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 2) 删除 account_proxy_bindings 对 proxies 的外键（若存在）
SELECT COUNT(*) INTO @fk_apb
FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'account_proxy_bindings' AND CONSTRAINT_NAME = 'fk_apb_proxy';
SET @drop_apb = IF(@fk_apb > 0, 'ALTER TABLE account_proxy_bindings DROP FOREIGN KEY fk_apb_proxy', 'SELECT 1 AS _noop');
PREPARE stmt FROM @drop_apb;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 3) 删除 sub_accounts 对 proxies 的外键（若存在）
SELECT COUNT(*) INTO @fk_sub
FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'sub_accounts' AND CONSTRAINT_NAME = 'fk_sub_accounts_proxy';
SET @drop_sub = IF(@fk_sub > 0, 'ALTER TABLE sub_accounts DROP FOREIGN KEY fk_sub_accounts_proxy', 'SELECT 1 AS _noop');
PREPARE stmt FROM @drop_sub;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 4) 统一列类型：proxies.id -> BIGINT UNSIGNED
ALTER TABLE proxies MODIFY id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT;

-- 5) proxy_audit.proxy_id -> BIGINT UNSIGNED NULL
ALTER TABLE proxy_audit MODIFY proxy_id BIGINT UNSIGNED NULL;

-- 6) account_proxy_bindings.proxy_id -> BIGINT UNSIGNED NOT NULL（若表存在）
-- 若表不存在可注释或跳过
ALTER TABLE account_proxy_bindings MODIFY proxy_id BIGINT UNSIGNED NOT NULL;

-- 7) sub_accounts.proxy_id -> BIGINT UNSIGNED NULL（若表存在）
ALTER TABLE sub_accounts MODIFY proxy_id BIGINT UNSIGNED NULL;

-- 8) 重新添加外键（仅当不存在时添加，保证幂等）
SELECT COUNT(*) INTO @fk_audit2 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'proxy_audit' AND CONSTRAINT_NAME = 'fk_proxy_audit_proxy';
SET @add_audit = IF(@fk_audit2 = 0,
  'ALTER TABLE proxy_audit ADD CONSTRAINT fk_proxy_audit_proxy FOREIGN KEY (proxy_id) REFERENCES proxies(id) ON DELETE SET NULL ON UPDATE CASCADE',
  'SELECT 1 AS _noop');
PREPARE stmt FROM @add_audit;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT COUNT(*) INTO @fk_apb2 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'account_proxy_bindings' AND CONSTRAINT_NAME = 'fk_apb_proxy';
SET @add_apb = IF(@fk_apb2 = 0,
  'ALTER TABLE account_proxy_bindings ADD CONSTRAINT fk_apb_proxy FOREIGN KEY (proxy_id) REFERENCES proxies(id) ON DELETE CASCADE',
  'SELECT 1 AS _noop');
PREPARE stmt FROM @add_apb;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT COUNT(*) INTO @fk_sub2 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'sub_accounts' AND CONSTRAINT_NAME = 'fk_sub_accounts_proxy';
SET @add_sub = IF(@fk_sub2 = 0,
  'ALTER TABLE sub_accounts ADD CONSTRAINT fk_sub_accounts_proxy FOREIGN KEY (proxy_id) REFERENCES proxies(id) ON DELETE SET NULL',
  'SELECT 1 AS _noop');
PREPARE stmt FROM @add_sub;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET FOREIGN_KEY_CHECKS = @old_fk_checks;

SELECT 'migrate_proxy_audit_fk 执行完成（proxies.id / proxy_audit.proxy_id 已统一为 BIGINT UNSIGNED）' AS result;
