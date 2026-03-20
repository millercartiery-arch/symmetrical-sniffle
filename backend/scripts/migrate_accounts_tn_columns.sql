-- 为 accounts 表补充 TN 相关列（与 schema_full_create / 前端 GET /tn-accounts 一致）
-- 若列已存在会报 ER_DUP_FIELDNAME，可忽略。
-- 用法：mysql -u root -p massmail < migrate_accounts_tn_columns.sql

USE massmail;

ALTER TABLE accounts ADD COLUMN tn_os VARCHAR(64) NULL;
ALTER TABLE accounts ADD COLUMN tn_type VARCHAR(64) NULL;
