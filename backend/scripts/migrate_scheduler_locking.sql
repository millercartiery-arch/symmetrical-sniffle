-- Scheduler locking migration
-- Adds locked_at and scheduler performance indexes for message_tasks.

ALTER TABLE message_tasks
  ADD COLUMN IF NOT EXISTS locked_at TIMESTAMP NULL;

ALTER TABLE message_tasks
  ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMP NULL;

ALTER TABLE message_tasks
  ADD COLUMN IF NOT EXISTS error_msg VARCHAR(255) NULL;

ALTER TABLE message_tasks
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;

CREATE INDEX idx_message_tasks_status_schedule
  ON message_tasks (status, scheduled_at, created_at);

CREATE INDEX idx_message_tasks_lock_state
  ON message_tasks (status, locked_at);
