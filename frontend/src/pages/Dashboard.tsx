// src/pages/Dashboard.tsx
import React, { memo } from "react";
import GlobalSignalPanel from "../components/Dashboard/GlobalSignalPanel";

/**
 * Dashboard – 系统概览面板
 * 仅显示 GlobalSignalPanel（账户概览 + 任务概览 + 健康状态）
 * 
 * 注意：任务列表已移至 /admin/tasks 独立页面，避免重复显示
 * Dashboard 只展示统计卡片，不嵌入完整列表
 */
const Dashboard: React.FC = () => {
  return (
    <section className="cm-dashboard-shell">
      <div className="cm-dashboard-backdrop" />
      <div className="cm-dashboard-frame">
        <GlobalSignalPanel compact={false} />
      </div>
    </section>
  );
};

export default memo(Dashboard);
