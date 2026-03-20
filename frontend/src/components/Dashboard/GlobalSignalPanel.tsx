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

const getDeltaLabel = (
  current: number,
  previous: number | undefined,
  t: (key: string, options?: Record<string, unknown>) => string
) => {
  if (previous == null) return t("dashboard.live_baseline");
  const delta = current - previous;
  if (delta === 0) return t("dashboard.stable_vs_last_refresh");
  const direction = delta > 0 ? "up" : "down";
  const base = previous === 0 ? 100 : Math.round((Math.abs(delta) / Math.abs(previous)) * 100);
  return t(`dashboard.delta_${direction}`, {
    defaultValue: delta > 0 ? "↑ {{percent}}% vs last refresh" : "↓ {{percent}}% vs last refresh",
    percent: base,
  });
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

const CompactPanel: React.FC<{
  data: DashboardStats;
  onRefresh: () => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}> = ({ data, onRefresh, t }) => (
  <Space size="middle" wrap>
    <Tag color="green">
      {t("dashboard.compact_online")} {data.onlineAccounts ?? 0}
    </Tag>
    <Tag color="blue">
      {t("dashboard.compact_sent")} {data.todaySent ?? 0}
    </Tag>
    <Tag color="orange">
      {t("dashboard.compact_failed")} {data.todayFailed ?? 0}
    </Tag>
    <Button icon={<ReloadOutlined />} size="small" onClick={onRefresh}>
      {t("common.refresh")}
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

  const executionPressure = Math.max(
    0,
    (data.runningTasks ?? 0) - ((data.onlineAccounts ?? 0) * 2 || 0)
  );
  const focusTone =
    (data.todayFailed ?? 0) > 0
      ? {
          title: t("dashboard.focus.delivery_title"),
          copy: t("dashboard.focus.delivery_copy"),
          cta: t("dashboard.focus.delivery_cta"),
          target: "/admin/tasks?status=failed",
        }
      : (data.deadAccounts ?? 0) > 0
        ? {
            title: t("dashboard.focus.recovery_title"),
            copy: t("dashboard.focus.recovery_copy"),
            cta: t("dashboard.focus.recovery_cta"),
            target: "/admin/accounts?status=Dead",
          }
        : executionPressure > 0
          ? {
              title: t("dashboard.focus.capacity_title"),
              copy: t("dashboard.focus.capacity_copy"),
              cta: t("dashboard.focus.capacity_cta"),
              target: "/admin/accounts?tab=proxy-pool",
            }
          : {
              title: t("dashboard.focus.clear_title"),
              copy: t("dashboard.focus.clear_copy"),
              cta: t("dashboard.focus.clear_cta"),
              target: "/admin/conversations",
            };

  const accountCards = useMemo(
    () => [
      {
        key: "accounts",
        title: t("dashboard.account.total"),
        value: data.totalAccounts ?? 0,
        meta: t("dashboard.cards.accounts_meta", { count: data.onlineAccounts ?? 0 }),
        icon: <UsergroupAddOutlined style={{ color: "#f6ece7", fontSize: 18 }} />,
      },
      {
        key: "online",
        title: t("dashboard.account.online"),
        value: data.onlineAccounts ?? 0,
        meta: t("dashboard.cards.online_meta", { percent: onlineRatio }),
        trend: getDeltaLabel(data.onlineAccounts ?? 0, previousSnapshot?.onlineAccounts, t),
        progress: (
          <Progress
            percent={onlineRatio}
            strokeColor={{ "0%": "#55616c", "100%": "#7b8791" }}
            trailColor="rgba(255,255,255,0.06)"
            showInfo={false}
          />
        ),
        icon: <ThunderboltOutlined style={{ color: "var(--cm-blue)", fontSize: 18 }} />,
      },
      {
        key: "todaySent",
        title: t("dashboard.message.todaySent"),
        value: data.todaySent ?? 0,
        meta: t("dashboard.cards.sent_meta"),
        sparkline: buildSparkline(history.map((item) => item.todaySent), "#3f69ff"),
        icon: <RiseOutlined style={{ color: "#3f69ff", fontSize: 18 }} />,
      },
      {
        key: "todayFailed",
        title: t("dashboard.message.todayFailed"),
        value: data.todayFailed ?? 0,
        meta: data.todayFailed
          ? t("dashboard.cards.failed_meta_active")
          : t("dashboard.cards.failed_meta_clear"),
        className: getLatencyTone(data.todayFailed ?? 0, data.deadAccounts ?? 0),
        onClick: () => navigate("/admin/tasks?status=failed"),
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
    ]
  );

  if (loading) {
    return (
      <div className="cm-page" style={{ padding: 18 }}>
        <Skeleton active paragraph={{ rows: 6 }} />
      </div>
    );
  }

  if (error) {
    return (
      <Card className="cm-page" style={{ padding: 10 }}>
        <Alert
          type="error"
          showIcon
          message={t("common.error")}
          description={error}
          action={<Button icon={<ReloadOutlined />} onClick={refresh}>{t("common.retry")}</Button>}
        />
      </Card>
    );
  }

  if (compact) {
    return <CompactPanel data={data} onRefresh={refresh} t={t} />;
  }

  return (
    <div className="cm-page" style={{ padding: 18 }}>
      <div className="cm-page-header">
        <div>
          <Text className="cm-kpi-eyebrow">{t("dashboard.overview_eyebrow")}</Text>
          <Title level={2} className="cm-page-title cm-brand-title">
            {t("dashboard.page_title")}
          </Title>
          <Text className="cm-page-subtitle">
            {t("dashboard.page_subtitle")}
          </Text>
        </div>
        <Space wrap>
          <div className="cm-health-pill">
            <CheckCircleOutlined style={{ color: "var(--cm-green)" }} />
            <span>{t("dashboard.system_health")}: {healthScore}%</span>
          </div>
          <Button icon={<ReloadOutlined />} onClick={refresh}>
            {t("common.refresh")}
          </Button>
        </Space>
      </div>

      <div className="cm-hero-band">
        <div className="cm-hero-panel">
          <Text className="cm-kpi-eyebrow">{t("dashboard.today_focus")}</Text>
          <Title level={3} style={{ color: "var(--cm-text-primary)", margin: "8px 0 8px" }}>
            {focusTone.title}
          </Title>
          <Text style={{ color: "var(--cm-text-secondary)", lineHeight: 1.7 }}>
            {focusTone.copy}
          </Text>
          <div className="cm-hero-metrics">
            <div className="cm-mini-stat">
              <div className="cm-kpi-eyebrow">{t("dashboard.ready_capacity")}</div>
              <strong>{data.onlineAccounts ?? 0}</strong>
              <span>{t("dashboard.ready_capacity_meta")}</span>
            </div>
            <div className="cm-mini-stat">
              <div className="cm-kpi-eyebrow">{t("dashboard.running_load")}</div>
              <strong>{data.runningTasks ?? 0}</strong>
              <span>{t("dashboard.running_load_meta")}</span>
            </div>
            <div className="cm-mini-stat">
              <div className="cm-kpi-eyebrow">{t("dashboard.risk_inventory")}</div>
              <strong>{(data.deadAccounts ?? 0) + (data.cooldownAccounts ?? 0)}</strong>
              <span>{t("dashboard.risk_inventory_meta")}</span>
            </div>
          </div>
          <div className="cm-priority-actions">
            <Button type="primary" className="cm-primary-button" onClick={() => navigate(focusTone.target)}>
              {focusTone.cta}
            </Button>
            <Button onClick={() => navigate("/admin/accounts")}>{t("dashboard.open_inventory")}</Button>
          </div>
        </div>

        <div className="cm-hero-panel">
          <Text className="cm-kpi-eyebrow">{t("dashboard.operator_brief")}</Text>
          <Title level={4} style={{ color: "var(--cm-text-primary)", margin: "8px 0 14px" }}>
            {t("dashboard.business_readout")}
          </Title>
          <div className="cm-signal-list">
            <div className="cm-signal-item">
              <div>
                <strong>{t("dashboard.inventory_coverage")}</strong>
                <span>{t("dashboard.inventory_coverage_meta")}</span>
              </div>
              <Tag color={onlineRatio >= 40 ? "green" : "orange"}>{onlineRatio}%</Tag>
            </div>
            <div className="cm-signal-item">
              <div>
                <strong>{t("dashboard.execution_quality")}</strong>
                <span>{t("dashboard.execution_quality_meta")}</span>
              </div>
              <Tag color={completionRate >= 80 ? "green" : "orange"}>{completionRate}%</Tag>
            </div>
            <div className="cm-signal-item">
              <div>
                <strong>{t("dashboard.failure_pressure")}</strong>
                <span>{t("dashboard.failure_pressure_meta")}</span>
              </div>
              <Tag color={(data.todayFailed ?? 0) > 0 ? "orange" : "green"}>{data.todayFailed ?? 0}</Tag>
            </div>
          </div>
        </div>
      </div>

      <div className="cm-kpi-grid" style={{ marginBottom: 12 }}>
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

      <div className="cm-priority-grid">
        <div className="cm-priority-card">
          <Text className="cm-kpi-eyebrow">{t("dashboard.recovery_eyebrow")}</Text>
          <h3>{t("dashboard.recovery_title")}</h3>
          <p>{t("dashboard.recovery_copy")}</p>
          <div className="cm-priority-actions">
            <Button onClick={() => navigate("/admin/accounts?status=Dead")}>{t("dashboard.locked_inventory")}</Button>
            <Button onClick={() => navigate("/admin/accounts?tab=proxy-pool")}>{t("dashboard.proxy_routing")}</Button>
          </div>
        </div>
        <div className="cm-priority-card">
          <Text className="cm-kpi-eyebrow">{t("dashboard.execution_eyebrow")}</Text>
          <h3>{t("dashboard.execution_title")}</h3>
          <p>{t("dashboard.execution_copy")}</p>
          <div className="cm-priority-actions">
            <Button type="primary" className="cm-primary-button" onClick={() => navigate("/admin/conversations")}>
              {t("dashboard.open_conversation_center")}
            </Button>
            <Button onClick={() => navigate("/admin/tasks")}>{t("dashboard.review_task_flow")}</Button>
          </div>
        </div>
      </div>

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={15}>
          <div className="cm-section-card" style={{ padding: 14 }}>
            <div className="cm-page-header" style={{ marginBottom: 12 }}>
              <div>
                <Text className="cm-kpi-eyebrow">{t("dashboard.execution_capacity")}</Text>
                <Title level={4} className="cm-page-title">
                  {t("dashboard.task_throughput")}
                </Title>
              </div>
              <Text style={{ color: "var(--cm-text-secondary)" }}>
                {t("dashboard.running_of_total", { running: data.runningTasks ?? 0, total: data.totalTasks ?? 0 })}
              </Text>
            </div>
            <Row gutter={[16, 16]}>
              <Col xs={24} md={12}>
                <div className="cm-glass-card" style={{ borderRadius: 16, padding: 14 }}>
                  <Text className="cm-kpi-eyebrow">{t("dashboard.completion_rate")}</Text>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 12 }}>
                    <Progress
                      type="circle"
                      percent={completionRate}
                      width={88}
                      strokeColor={{ "0%": "#55616c", "100%": "#7b8791" }}
                      trailColor="rgba(255,255,255,0.08)"
                    />
                    <div style={{ flex: 1 }}>
                      <Title level={3} style={{ color: "var(--cm-text-primary)", margin: 0 }}>
                        {completionRate}%
                      </Title>
                      <Text style={{ color: "var(--cm-text-secondary)" }}>
                        {t("dashboard.success_quality")}
                      </Text>
                    </div>
                  </div>
                </div>
              </Col>
              <Col xs={24} md={12}>
                <div className="cm-glass-card" style={{ borderRadius: 16, padding: 14, height: "100%" }}>
                  <Text className="cm-kpi-eyebrow">{t("dashboard.immediate_actions")}</Text>
                  <Space direction="vertical" size={10} style={{ width: "100%", marginTop: 12 }}>
                    <Button block onClick={() => navigate("/admin/accounts?status=Dead")}>{t("dashboard.recover_locked_inventory")}</Button>
                    <Button block onClick={() => navigate("/admin/conversations")}>{t("dashboard.prioritize_live_conversations")}</Button>
                    <Button block type="primary" className="cm-primary-button" onClick={() => navigate("/admin/accounts?tab=proxy-pool")}>
                      {t("dashboard.validate_proxy_routing")}
                    </Button>
                  </Space>
                </div>
              </Col>
            </Row>
          </div>
        </Col>
        <Col xs={24} xl={9}>
          <div className="cm-section-card" style={{ padding: 14, height: "100%" }}>
            <Text className="cm-kpi-eyebrow">{t("dashboard.live_status")}</Text>
            <Title level={4} className="cm-page-title" style={{ marginTop: 6 }}>
              {t("dashboard.operational_signals")}
            </Title>
            <div className="cm-signal-list" style={{ marginTop: 10 }}>
              <div className="cm-signal-item">
                <div>
                  <strong>{t("dashboard.cooldown_accounts")}</strong>
                  <span>{t("dashboard.cooldown_accounts_meta")}</span>
                </div>
                <Tag color="orange">{data.cooldownAccounts ?? 0}</Tag>
              </div>
              <div className="cm-signal-item">
                <div>
                  <strong>{t("dashboard.running_tasks")}</strong>
                  <span>{t("dashboard.running_tasks_meta")}</span>
                </div>
                <Tag color="blue">{data.runningTasks ?? 0}</Tag>
              </div>
              <div className="cm-signal-item">
                <div>
                  <strong>{t("dashboard.last_update")}</strong>
                  <span>{t("dashboard.last_update_meta")}</span>
                </div>
                <Tag>
                  {data.system?.lastUpdate
                    ? new Date(data.system.lastUpdate).toLocaleTimeString()
                    : "--"}
                </Tag>
              </div>
            </div>
          </div>
        </Col>
      </Row>
    </div>
  );
};

export default memo(GlobalSignalPanel);
