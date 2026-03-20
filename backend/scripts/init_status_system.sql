-- =====================================================
-- 数据库初始化脚本 - 实时状态管理系统
-- ====================================================

-- 1. 扩展 accounts 表（如果尚未添加）
-- 检查表是否存在，如果不存在则创建基础版本
CREATE TABLE IF NOT EXISTS `accounts` (
  `id` VARCHAR(36) PRIMARY KEY,
  `phone` VARCHAR(50) UNIQUE NOT NULL,
  `email` VARCHAR(255),
  `username` VARCHAR(255),
  `password_hash` VARCHAR(255),
  `system_type` VARCHAR(50),
  `proxy_url` VARCHAR(500),
  `last_used_at` TIMESTAMP NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 添加状态管理列（如果不存在）
ALTER TABLE `accounts` ADD COLUMN IF NOT EXISTS `status` ENUM('UNKNOWN', 'LOGGING_IN', 'READY', 'BUSY', 'ERROR', 'DISABLED') DEFAULT 'UNKNOWN' AFTER `updated_at`;
ALTER TABLE `accounts` ADD COLUMN IF NOT EXISTS `error_msg` TEXT AFTER `status`;

-- 2. 创建 tasks 表
CREATE TABLE IF NOT EXISTS `tasks` (
  `id` VARCHAR(36) PRIMARY KEY,
  `name` VARCHAR(255) NOT NULL COMMENT '任务名称',
  `recipient` VARCHAR(50) NOT NULL COMMENT '收件人电话',
  `content` TEXT NOT NULL COMMENT '发送内容',
  `status` ENUM('PENDING', 'LOCKED', 'SENDING', 'SUCCESS', 'FAILED', 'CANCELLED') DEFAULT 'PENDING' COMMENT '任务状态',
  `progress` INT DEFAULT 0 COMMENT '发送进度 0-100',
  `error_msg` TEXT COMMENT '错误信息',
  `account_id` VARCHAR(36) COMMENT '分配的账户',
  `scheduled_at` TIMESTAMP NULL COMMENT '计划发送时间',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY `idx_status` (`status`),
  KEY `idx_account_id` (`account_id`),
  KEY `idx_created_at` (`created_at`),
  FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. 创建任务事件日志表（用于审计）
CREATE TABLE IF NOT EXISTS `task_events` (
  `id` VARCHAR(36) PRIMARY KEY,
  `task_id` VARCHAR(36) NOT NULL,
  `account_id` VARCHAR(36),
  `event_type` VARCHAR(50) COMMENT 'CREATED, LOCKED, SENDING, SUCCESS, FAILED, CANCELLED',
  `old_status` VARCHAR(50),
  `new_status` VARCHAR(50),
  `old_progress` INT,
  `new_progress` INT,
  `error_msg` TEXT,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY `idx_task_id` (`task_id`),
  KEY `idx_created_at` (`created_at`),
  FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. 创建账户事件日志表
CREATE TABLE IF NOT EXISTS `account_events` (
  `id` VARCHAR(36) PRIMARY KEY,
  `account_id` VARCHAR(36) NOT NULL,
  `event_type` VARCHAR(50) COMMENT 'PROBE, STATUS_CHANGE, ERROR',
  `old_status` VARCHAR(50),
  `new_status` VARCHAR(50),
  `error_msg` TEXT,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY `idx_account_id` (`account_id`),
  KEY `idx_created_at` (`created_at`),
  FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. 创建索引以优化查询性能
ALTER TABLE `accounts` ADD INDEX IF NOT EXISTS `idx_status` (`status`);
ALTER TABLE `accounts` ADD INDEX IF NOT EXISTS `idx_updated_at` (`updated_at`);

-- 6. 插入示例数据（可选）
-- 本注释掉，避免初始化时产生重复数据
-- INSERT INTO `accounts` VALUES 
-- ('acc-001', '13800138000', 'user1@example.com', 'user1', NULL, 'TextNow', NULL, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'UNKNOWN', NULL);

-- 7. 创建数据库视图 - 任务统计
CREATE OR REPLACE VIEW `v_task_summary` AS
SELECT 
  COUNT(*) as total,
  SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END) as pending_count,
  SUM(CASE WHEN status = 'LOCKED' THEN 1 ELSE 0 END) as locked_count,
  SUM(CASE WHEN status = 'SENDING' THEN 1 ELSE 0 END) as sending_count,
  SUM(CASE WHEN status = 'SUCCESS' THEN 1 ELSE 0 END) as success_count,
  SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) as failed_count,
  SUM(CASE WHEN status = 'CANCELLED' THEN 1 ELSE 0 END) as cancelled_count,
  AVG(progress) as avg_progress
FROM tasks;

-- 8. 创建存储过程 - 更新任务状态（带事件记录）
DELIMITER //
CREATE OR REPLACE PROCEDURE `sp_update_task_status`(
  IN p_task_id VARCHAR(36),
  IN p_new_status VARCHAR(50),
  IN p_progress INT,
  IN p_error_msg TEXT
)
BEGIN
  DECLARE v_old_status VARCHAR(50);
  DECLARE v_account_id VARCHAR(36);
  
  -- 获取旧状态和账户ID
  SELECT `status`, `account_id` INTO v_old_status, v_account_id
  FROM jobs WHERE `id` = p_task_id;
  
  -- 更新任务状态
  UPDATE tasks 
  SET `status` = p_new_status, 
      `progress` = p_progress,
      `error_msg` = p_error_msg,
      `updated_at` = NOW()
  WHERE `id` = p_task_id;
  
  -- 记录事件
  INSERT INTO task_events (id, task_id, account_id, event_type, old_status, new_status, new_progress, error_msg)
  VALUES (UUID(), p_task_id, v_account_id, 'STATUS_CHANGE', v_old_status, p_new_status, p_progress, p_error_msg);
  
END//
DELIMITER ;

-- 9. 清理旧数据的定时任务（保留最近30天的事件日志）
-- 这个需要在 MySQL 中启用事件调度器：SET GLOBAL event_scheduler = ON;
CREATE EVENT IF NOT EXISTS `e_cleanup_old_events`
ON SCHEDULE EVERY 1 DAY
STARTS NOW()
DO
BEGIN
  DELETE FROM task_events WHERE created_at < DATE_SUB(NOW(), INTERVAL 30 DAY);
  DELETE FROM account_events WHERE created_at < DATE_SUB(NOW(), INTERVAL 30 DAY);
END;

-- 10. 显示初始化完成信息
SELECT '✅ 数据库初始化完成！' as message;

-- 显示当前表结构
SHOW TABLES;
