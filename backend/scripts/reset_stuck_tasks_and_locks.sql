-- ============================================================
-- 安全释放陈旧锁并回池（任务卡在 LOCKED/Processing、账号卡在 Busy）
-- 当 Worker 进程挂了或异常退出时，任务和账号可能一直处于锁定状态，
-- 执行本脚本可将其重置，让调度器重新调度。
--
-- 用法：在 MySQL 中 USE massmail; 后执行对应段落。
-- ============================================================

USE massmail;

-- ---------- 1. 仅释放“超过 5 分钟”的陈旧锁（与 scheduler 逻辑一致，最安全）----------
-- 任务：LOCKED/Processing 且 locked_at 超过 5 分钟 -> Pending
UPDATE message_tasks
SET status = 'Pending',
    locked_at = NULL
WHERE status IN ('LOCKED', 'Processing')
  AND locked_at IS NOT NULL
  AND locked_at < DATE_SUB(NOW(), INTERVAL 5 MINUTE);

-- 账号：Busy 且 locked_at 超过 5 分钟 -> Ready
UPDATE accounts
SET status = 'Ready',
    locked_at = NULL,
    locked_by = NULL
WHERE status = 'Busy'
  AND locked_at IS NOT NULL
  AND locked_at < DATE_SUB(NOW(), INTERVAL 5 MINUTE);


-- ---------- 2. 强制释放所有卡住的任务和账号（不限时间，慎用）----------
-- 若确认 Worker 已停或需要立刻让任务重新进入队列，执行下面两段。

UPDATE message_tasks
SET status = 'Pending', locked_at = NULL, account_id = NULL
WHERE status IN ('LOCKED', 'Processing');

UPDATE accounts
SET status = 'Ready', locked_at = NULL, locked_by = NULL
WHERE status = 'Busy';


-- ---------- 3. 对齐租户 ID（与子账号 subop_20260316_1 一致）----------
SET @subop_tenant_id = (SELECT tenant_id FROM users WHERE username = 'subop_20260316_1' LIMIT 1);
UPDATE message_tasks SET tenant_id = @subop_tenant_id WHERE @subop_tenant_id IS NOT NULL;
UPDATE campaigns SET tenant_id = @subop_tenant_id WHERE @subop_tenant_id IS NOT NULL;


-- ---------- 4. 查看当前状态分布（排查用）----------
SELECT status, COUNT(*) AS cnt FROM message_tasks GROUP BY status;
SELECT status, COUNT(*) AS cnt FROM accounts GROUP BY status;
SELECT tenant_id, COUNT(*) AS cnt FROM message_tasks GROUP BY tenant_id;
SELECT tenant_id, COUNT(*) AS cnt FROM campaigns GROUP BY tenant_id;
