/**
 * 看板统计（UI 使用）
 */
export interface DashboardStats {
  totalTasks?: number;
  runningTasks?: number;
  completionRate?: number;
  failedTasks?: number;
  totalAccounts?: number;
  onlineAccounts?: number;
  cooldownAccounts?: number;
  deadAccounts?: number;
  todaySent?: number;
  todayFailed?: number;
  system?: {
    lastUpdate?: string;
    healthy?: boolean;
  };
}

/**
 * 后端 /dashboard/stats 实际返回结构（本项目）
 */
export interface DashboardStatsResponse {
  task?: {
    total?: number;
    inProgress?: number;
    completed?: number;
    failed?: number;
    successRate?: number;
  };
  account?: {
    total?: number;
    online?: number;
    offline?: number;
    cooldown?: number;
    todaySent?: number;
    todayFailed?: number;
  };
}
