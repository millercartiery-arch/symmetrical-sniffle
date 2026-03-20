-- 清除 message_tasks 多余字段（与业务脱钩的旧列）
-- 业务只使用 error_msg、updated_at，不再使用 error_message、processed_at、completed_at
-- 用法：在 massmail 库下执行。若某列已不存在会报 Unknown column，可跳过该句。
-- 建议：执行前备份或先在测试环境执行；MySQL 8.0.29+ 支持 DROP COLUMN IF EXISTS，旧版请逐条执行。

USE massmail;

ALTER TABLE message_tasks DROP COLUMN error_message;
ALTER TABLE message_tasks DROP COLUMN processed_at;
ALTER TABLE message_tasks DROP COLUMN completed_at;
