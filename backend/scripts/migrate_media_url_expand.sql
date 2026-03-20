-- Expand message_tasks.media_url to avoid truncation for image/rich payloads.
ALTER TABLE message_tasks
  MODIFY COLUMN media_url TEXT NULL;
