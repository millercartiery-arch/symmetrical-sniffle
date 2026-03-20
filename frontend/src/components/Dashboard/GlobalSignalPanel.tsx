import React, { memo, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Col,
  Progress,
  Row,
  Skeleton,
  Space,
  Tag,
  Typography,
} from "antd";
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  ReloadOutlined,
  RiseOutlined,
  ThunderboltOutlined,
  UsergroupAddOutlined,
} from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useDashboardStats } from "../../hooks/useDashboardStats";
import type { DashboardStats } from "../../types/dashboard";

const { Text, Title } = Typography;

interface GlobalSignalPanelProps {
  compact?: boolean;
}

type Snapshot = {
  onlineAccounts: number;
  todaySent: number;
  todayFailed: number;
  timestamp: number;
};

const MAX_HISTORY = 12;

const toPercent = (part: number, total: number) =>
  total > 0 ? Math.round((part / total) * 100) : 0;

const getDeltaLabel = (current: number, previous?: number) => {
  if (previous == null) return "Live baseline";
  const delta = current - previous;
  if (delta === 0) return "Stable vs last refresh";
  const symbol = delta > 0 ? "↑" : "↓";
  const base = previous === 0 ? 100 : Math.round((Math.abs(delta) / Math.abs(previous)) * 100);
  return `${symbol} ${base}% vs last refresh`;
};

const getLatencyTone = (failed: number, dead: number) => {
  if (failed > 0 || dead > 0) return "cm-danger cm-pulse";
  return "";
};

const buildSparkline = (values: number[], color: string) => {
  const safe = values.length > 1 ? values : [values[0] ?? 0, values[0] ?? 0];
  const max = Math.max(...safe, 1);
  const min = Math.min(...safe, 0);
  const range = max - min || 1;
  const points = safe
    .map((value, index) => {
      const x = (index / (safe.length - 1)) * 100;
      const y = 100 - ((value - min) / range) * 100;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: "100%", height: 48 }}>
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="5"
        strokeLinejoin="round"
        strokeLinecap="round"
        points={points}
      />
    </svg>
  );
};

const CompactPanel: React.FC<{ data: DashboardStats; onRefresh: () => void }> = ({ data, onRefresh }) => (
  <Space size="middle" wrap>
    <Tag color="green">Online {data.onlineAccounts ?? 0}</Tag>
    <Tag color="blue">Sent {data.todaySent ?? 0}</Tag>
    <Tag color="red">Failed {data.todayFailed ?? 0}</Tag>
    <Button icon={<ReloadOutlined />} size="small" onClick={onRefresh}>
      Refresh
    </Button>
  </Space>
);

const GlobalSignalPanel: React.FC<GlobalSignalPanelProps> = ({ compact = false }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data, loading, error, refresh } = useDashboardStats(30_000);
  const [history, setHistory] = useState<Snapshot[]>([]);

  useEffect(() => {
    if (!data.totalAccounts && !data.totalTasks && !data.todaySent && !data.todayFailed) return;
    setHistory((prev) => {
      const next = [
        ...prev,
        {
          onlineAccounts: data.onlineAccounts ?? 0,
          todaySent: data.todaySent ?? 0,
          todayFailed: data.todayFailed ?? 0,
          timestamp: Date.now(),
        },
      ];
      return next.slice(-MAX_HISTORY);
    });
  }, [data.onlineAccounts, data.todaySent, data.todayFailed, data.totalAccounts, data.totalTasks]);

  const previousSnapshot = history.length > 1 ? history[history.length - 2] : undefined;
  const onlineRatio = toPercent(data.onlineAccounts ?? 0, data.totalAccounts ?? 0);
  const completionRate = Math.max(0, Math.min(100, data.completionRate ?? 0));
  const healthScore = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        onlineRatio * 0.55 +
          completionRate * 0.35 -
          (data.todayFailed ?? 0) * 4 -
          (data.deadAccounts ?? 0) * 3
      )
    )
  );

  const accountCards = useMemo(
    () => [
      {
        key: "accounts",
        title: t("dashboard.account.total", { defaultValue: "Total Accounts" }),
        value: data.totalAccounts ?? 0,
        meta: `${data.onlineAccounts ?? 0} active routing nodes`,
        icon: <UsergroupAddOutlined style={{ color: "#f6ece7", fontSize: 18 }} />,
      },
      {
        key: "online",
        title: t("dashboard.account.online", { defaultValue: "Online Accounts" }),
        value: data.onlineAccounts ?? 0,
        meta: `${onlineRatio}% of total inventory`,
        trend: getDeltaLabel(data.onlineAccounts ?? 0, previousSnapshot?.onlineAccounts),
        progress: (
          <Progress
            percent={onlineRatio}
            strokeColor={{ "0%": "#8B0000", "100%": "#B22222" }}
            trailColor="rgba(255,255,255,0.06)"
            showInfo={false}
          />
        ),
        icon: <ThunderboltOutlined style={{ color: "#16a34a", fontSize: 18 }} />,
      },
      {
        key: "todaySent",
        title: t("dashboard.message.todaySent", { defaultValue: "Today Sent" }),
        value: data.todaySent ?? 0,
        meta: getDeltaLabel(data.todaySent ?? 0, previousSnapshot?.todaySent),
        sparkline: buildSparkline(history.map((item) => item.todaySent), "#3f69ff"),
        icon: <RiseOutlined style={{ color: "#3f69ff", fontSize: 18 }} />,
      },
      {
        key: "todayFailed",
        title: t("dashboard.message.todayFailed", { defaultValue: "Today Failed" }),
        value: data.todayFailed ?? 0,
        meta: data.todayFailed ? "Requires immediate review" : "No active delivery failures",
        className: getLatencyTone(data.todayFailed ?? 0, data.deadAccounts ?? 0),
        onClick: () => navigate("/admin/tasks?status=failed"),
        icon: <CloseCircleOutlined style={{ color: "#c0392b", fontSize: 18 }} />,
      },
      {
        key: "dead",
        title: t("dashboard.account.dead", { defaultValue: "Dead / Locked" }),
        value: data.deadAccounts ?? 0,
        meta: data.deadAccounts ? "Click to isolate affected inventory" : "Inventory lock rate is under control",
        className: getLatencyTone(data.todayFailed ?? 0, data.deadAccounts ?? 0),
        onClick: () => navigate("/admin/accounts?status=Dead"),
        icon: <CloseCircleOutlined style={{ color: "#c0392b", fontSize: 18 }} />,
      },
    ],
    [
      t,
      data.totalAccounts,
      data.onlineAccounts,
      data.todaySent,
      data.todayFailed,
      data.deadAccounts,
      history,
      navigate,
      onlineRatio,
      previousSnapshot?.onlineAccounts,
      previousSnapshot?.todaySent,
    ]
  );

  if (loading) {
    return (
      <div className="cm-page" style={{ padding: 24 }}>
        <Skeleton active paragraph={{ rows: 6 }} />
      </div>
    );
  }

  if (error) {
    return (
      <Card className="cm-page" style={{ padding: 12 }}>
        <Alert
          type="error"
          showIcon
          message={t("common.error", { defaultValue: "加载失败" })}
          description={error}
          action={<Button icon={<ReloadOutlined />} onClick={refresh}>Retry</Button>}
        />
      </Card>
    );
  }

  if (compact) {
    return <CompactPanel data={data} onRefresh={refresh} />;
  }

  return (
    <div className="cm-page" style={{ padding: 24 }}>
      <div className="cm-page-header">
        <div>
          <Text className="cm-kpi-eyebrow">System Overview</Text>
          <Title level={2} className="cm-page-title cm-brand-title">
            Command Dashboard
          </Title>
          <Text className="cm-page-subtitle">
            Rebuilt around high-contrast monitoring: critical metrics are surfaced first, abnormal states are visually amplified, and routing health is always visible.
          </Text>
        </div>
        <Space wrap>
          <div className="cm-health-pill">
            <CheckCircleOutlined style={{ color: "#16a34a" }} />
            <span>System Health: {healthScore}%</span>
          </div>
          <Button icon={<ReloadOutlined />} onClick={refresh}>
            {t("common.refresh", { defaultValue: "刷新" })}
          </Button>
        </Space>
      </div>

      <div className="cm-kpi-grid" style={{ marginBottom: 18 }}>
        {accountCards.map((card) => (
          <button
            key={card.key}
            type="button"
            className={`cm-kpi-card ${card.className ?? ""}`}
            onClick={card.onClick}
            style={{
              cursor: card.onClick ? "pointer" : "default",
              textAlign: "left",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <div>
                <div className="cm-kpi-eyebrow">{card.title}</div>
                <strong className="cm-kpi-value">{card.value}</strong>
              </div>
              <div>{card.icon}</div>
            </div>
            <div className="cm-kpi-meta" style={{ marginTop: 12 }}>
              {card.meta}
            </div>
            {card.progress ? <div style={{ marginTop: 14 }}>{card.progress}</div> : null}
            {card.sparkline ? <div style={{ marginTop: 12 }}>{card.sparkline}</div> : null}
            {card.trend ? (
              <Text style={{ color: "#c5aea8", fontSize: 12, marginTop: 10, display: "block" }}>
                {card.trend}
              </Text>
            ) : null}
          </button>
        ))}
      </div>

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={15}>
          <div className="cm-section-card" style={{ padding: 20 }}>
            <div className="cm-page-header" style={{ marginBottom: 12 }}>
              <div>
                <Text className="cm-kpi-eyebrow">Execution Capacity</Text>
                <Title level={4} className="cm-page-title">
                  Task Throughput
                </Title>
              </div>
              <Text style={{ color: "#b9a19a" }}>
                {data.runningTasks ?? 0} running of {data.totalTasks ?? 0} total tasks
              </Text>
            </div>
            <Row gutter={[16, 16]}>
              <Col xs={24} md={12}>
                <div className="cm-glass-card" style={{ borderRadius: 20, padding: 18 }}>
                  <Text className="cm-kpi-eyebrow">Completion Rate</Text>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, marginTop: 16 }}>
                    <Progress
                      type="circle"
                      percent={completionRate}
                      width={118}
                      strokeColor={{ "0%": "#8B0000", "100%": "#B22222" }}
                      trailColor="rgba(255,255,255,0.08)"
                    />
                    <div style={{ flex: 1 }}>
                      <Title level={3} style={{ color: "#f7ece8", margin: 0 }}>
                        {completionRate}%
                      </Title>
                      <Text style={{ color: "#b9a19a" }}>
                        Completion is derived from active task success versus failure counts.
                      </Text>
                    </div>
                  </div>
                </div>
              </Col>
              <Col xs={24} md={12}>
                <div className="cm-glass-card" style={{ borderRadius: 20, padding: 18, height: "100%" }}>
                  <Text className="cm-kpi-eyebrow">Immediate Actions</Text>
                  <Space direction="vertical" size={12} style={{ width: "100%", marginTop: 18 }}>
                    <Button block onClick={() => navigate("/admin/accounts?status=Dead")}>
                      Review locked inventory
                    </Button>
                    <Button block onClick={() => navigate("/admin/conversations")}>
                      Open conversation center
                    </Button>
                    <Button block type="primary" className="cm-primary-button" onClick={() => navigate("/admin/accounts?tab=proxy-pool")}>
                      Check proxy routing
                    </Button>
                  </Space>
                </div>
              </Col>
            </Row>
          </div>
        </Col>
        <Col xs={24} xl={9}>
          <div className="cm-section-card" style={{ padding: 20, height: "100%" }}>
            <Text className="cm-kpi-eyebrow">Live Status</Text>
            <Title level={4} className="cm-page-title" style={{ marginTop: 8 }}>
              Operational Signals
            </Title>
            <Space direction="vertical" size={14} style={{ width: "100%", marginTop: 14 }}>
              <div className="cm-health-pill" style={{ justifyContent: "space-between", width: "100%" }}>
                <span>Cooldown Accounts</span>
                <strong>{data.cooldownAccounts ?? 0}</strong>
              </div>
              <div className="cm-health-pill" style={{ justifyContent: "space-between", width: "100%" }}>
                <span>Running Tasks</span>
                <strong>{data.runningTasks ?? 0}</strong>
              </div>
              <div className="cm-health-pill" style={{ justifyContent: "space-between", width: "100%" }}>
                <span>Last Update</span>
                <strong style={{ fontSize: 12 }}>
                  {data.system?.lastUpdate
                    ? new Date(data.system.lastUpdate).toLocaleTimeString()
                    : "--"}
                </strong>
              </div>
            </Space>
          </div>
        </Col>
      </Row>
    </div>
  );
};

export default memo(GlobalSignalPanel);
