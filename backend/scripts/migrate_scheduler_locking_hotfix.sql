-- Production hotfix migration for scheduler locking (MySQL compatibility mode).
ALTER TABLE message_tasks ADD COLUMN locked_at TIMESTAMP NULL;
ALTER TABLE message_tasks ADD COLUMN scheduled_at TIMESTAMP NULL;
ALTER TABLE message_tasks ADD COLUMN error_msg VARCHAR(255) NULL;
ALTER TABLE message_tasks ADD COLUMN updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;

CREATE INDEX idx_message_tasks_status_schedule ON message_tasks (status, scheduled_at, created_at);
CREATE INDEX idx_message_tasks_lock_state ON message_tasks (status, locked_at);
