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
  if (previous == null) return t("dashboard.live_baseline", { defaultValue: "Live baseline" });
  const delta = current - previous;
  if (delta === 0) return t("dashboard.stable_vs_last_refresh", { defaultValue: "Stable vs last refresh" });
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
      {t("dashboard.compact_online", { defaultValue: "Online" })} {data.onlineAccounts ?? 0}
    </Tag>
    <Tag color="blue">
      {t("dashboard.compact_sent", { defaultValue: "Sent" })} {data.todaySent ?? 0}
    </Tag>
    <Tag color="orange">
      {t("dashboard.compact_failed", { defaultValue: "Failed" })} {data.todayFailed ?? 0}
    </Tag>
    <Button icon={<ReloadOutlined />} size="small" onClick={onRefresh}>
      {t("common.refresh", { defaultValue: "刷新" })}
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
          title: t("dashboard.focus.delivery_title", {
            defaultValue: "Delivery issues require attention",
          }),
          copy: t("dashboard.focus.delivery_copy", {
            defaultValue:
              "One or more sends failed recently. Review failed tasks before opening new throughput.",
          }),
          cta: t("dashboard.focus.delivery_cta", { defaultValue: "Review failed tasks" }),
          target: "/admin/tasks?status=failed",
        }
      : (data.deadAccounts ?? 0) > 0
        ? {
            title: t("dashboard.focus.recovery_title", {
              defaultValue: "Inventory recovery should come first",
            }),
            copy: t("dashboard.focus.recovery_copy", {
              defaultValue:
                "Locked or dead accounts are reducing usable capacity. Clean inventory before scaling campaigns.",
            }),
            cta: t("dashboard.focus.recovery_cta", { defaultValue: "Inspect locked inventory" }),
            target: "/admin/accounts?status=Dead",
          }
        : executionPressure > 0
          ? {
              title: t("dashboard.focus.capacity_title", {
                defaultValue: "Capacity is close to saturation",
              }),
              copy: t("dashboard.focus.capacity_copy", {
                defaultValue:
                  "Running work is high compared with available inventory. Rebalance proxies and ready accounts before adding more load.",
              }),
              cta: t("dashboard.focus.capacity_cta", { defaultValue: "Open proxy routing" }),
              target: "/admin/accounts?tab=proxy-pool",
            }
          : {
              title: t("dashboard.focus.clear_title", {
                defaultValue: "System is clear for outbound work",
              }),
              copy: t("dashboard.focus.clear_copy", {
                defaultValue:
                  "Routing health is stable and there are no active delivery alarms. You can safely move into execution and conversation handling.",
              }),
              cta: t("dashboard.focus.clear_cta", { defaultValue: "Open conversation center" }),
              target: "/admin/conversations",
            };

  const accountCards = useMemo(
    () => [
      {
        key: "accounts",
        title: t("dashboard.account.total", { defaultValue: "Total Accounts" }),
        value: data.totalAccounts ?? 0,
        meta: t("dashboard.cards.accounts_meta", {
          defaultValue: "{{count}} accounts available for active routing",
          count: data.onlineAccounts ?? 0,
        }),
        icon: <UsergroupAddOutlined style={{ color: "#f6ece7", fontSize: 18 }} />,
      },
      {
        key: "online",
        title: t("dashboard.account.online", { defaultValue: "Online Accounts" }),
        value: data.onlineAccounts ?? 0,
        meta: t("dashboard.cards.online_meta", {
          defaultValue: "{{percent}}% of inventory is currently available",
          percent: onlineRatio,
        }),
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
        title: t("dashboard.message.todaySent", { defaultValue: "Today Sent" }),
        value: data.todaySent ?? 0,
        meta: t("dashboard.cards.sent_meta", {
          defaultValue: "Outbound baseline for today's operator activity",
        }),
        sparkline: buildSparkline(history.map((item) => item.todaySent), "#3f69ff"),
        icon: <RiseOutlined style={{ color: "#3f69ff", fontSize: 18 }} />,
      },
      {
        key: "todayFailed",
        title: t("dashboard.message.todayFailed", { defaultValue: "Today Failed" }),
        value: data.todayFailed ?? 0,
        meta: data.todayFailed
          ? t("dashboard.cards.failed_meta_active", {
              defaultValue: "Failures are active and should be reviewed now",
            })
          : t("dashboard.cards.failed_meta_clear", {
              defaultValue: "No active delivery alarms",
            }),
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
          message={t("common.error", { defaultValue: "加载失败" })}
          description={error}
          action={<Button icon={<ReloadOutlined />} onClick={refresh}>{t("common.retry", { defaultValue: "重试" })}</Button>}
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
          <Text className="cm-kpi-eyebrow">{t("dashboard.overview_eyebrow", { defaultValue: "System Overview" })}</Text>
          <Title level={2} className="cm-page-title cm-brand-title">
            {t("dashboard.page_title", { defaultValue: "Command Dashboard" })}
          </Title>
          <Text className="cm-page-subtitle">
            {t("dashboard.page_subtitle", {
              defaultValue:
                "Run the operation from signals, not raw tables. This view surfaces what needs action, what is stable and where capacity is slipping.",
            })}
          </Text>
        </div>
        <Space wrap>
          <div className="cm-health-pill">
            <CheckCircleOutlined style={{ color: "var(--cm-green)" }} />
            <span>{t("dashboard.system_health", { defaultValue: "System Health" })}: {healthScore}%</span>
          </div>
          <Button icon={<ReloadOutlined />} onClick={refresh}>
            {t("common.refresh", { defaultValue: "刷新" })}
          </Button>
        </Space>
      </div>

      <div className="cm-hero-band">
        <div className="cm-hero-panel">
          <Text className="cm-kpi-eyebrow">{t("dashboard.today_focus", { defaultValue: "Today's Focus" })}</Text>
          <Title level={3} style={{ color: "var(--cm-text-primary)", margin: "8px 0 8px" }}>
            {focusTone.title}
          </Title>
          <Text style={{ color: "var(--cm-text-secondary)", lineHeight: 1.7 }}>
            {focusTone.copy}
          </Text>
          <div className="cm-hero-metrics">
            <div className="cm-mini-stat">
              <div className="cm-kpi-eyebrow">{t("dashboard.ready_capacity", { defaultValue: "Ready Capacity" })}</div>
              <strong>{data.onlineAccounts ?? 0}</strong>
              <span>{t("dashboard.ready_capacity_meta", { defaultValue: "Accounts ready for live routing" })}</span>
            </div>
            <div className="cm-mini-stat">
              <div className="cm-kpi-eyebrow">{t("dashboard.running_load", { defaultValue: "Running Load" })}</div>
              <strong>{data.runningTasks ?? 0}</strong>
              <span>{t("dashboard.running_load_meta", { defaultValue: "Tasks currently consuming throughput" })}</span>
            </div>
            <div className="cm-mini-stat">
              <div className="cm-kpi-eyebrow">{t("dashboard.risk_inventory", { defaultValue: "Risk Inventory" })}</div>
              <strong>{(data.deadAccounts ?? 0) + (data.cooldownAccounts ?? 0)}</strong>
              <span>{t("dashboard.risk_inventory_meta", { defaultValue: "Locked and cooling accounts combined" })}</span>
            </div>
          </div>
          <div className="cm-priority-actions">
            <Button type="primary" className="cm-primary-button" onClick={() => navigate(focusTone.target)}>
              {focusTone.cta}
            </Button>
            <Button onClick={() => navigate("/admin/accounts")}>{t("dashboard.open_inventory", { defaultValue: "Open inventory" })}</Button>
          </div>
        </div>

        <div className="cm-hero-panel">
          <Text className="cm-kpi-eyebrow">{t("dashboard.operator_brief", { defaultValue: "Operator Brief" })}</Text>
          <Title level={4} style={{ color: "var(--cm-text-primary)", margin: "8px 0 14px" }}>
            {t("dashboard.business_readout", { defaultValue: "Business Readout" })}
          </Title>
          <div className="cm-signal-list">
            <div className="cm-signal-item">
              <div>
                <strong>{t("dashboard.inventory_coverage", { defaultValue: "Inventory Coverage" })}</strong>
                <span>{t("dashboard.inventory_coverage_meta", { defaultValue: "Percent of total accounts available right now" })}</span>
              </div>
              <Tag color={onlineRatio >= 40 ? "green" : "orange"}>{onlineRatio}%</Tag>
            </div>
            <div className="cm-signal-item">
              <div>
                <strong>{t("dashboard.execution_quality", { defaultValue: "Execution Quality" })}</strong>
                <span>{t("dashboard.execution_quality_meta", { defaultValue: "Completion rate across active task flow" })}</span>
              </div>
              <Tag color={completionRate >= 80 ? "green" : "orange"}>{completionRate}%</Tag>
            </div>
            <div className="cm-signal-item">
              <div>
                <strong>{t("dashboard.failure_pressure", { defaultValue: "Failure Pressure" })}</strong>
                <span>{t("dashboard.failure_pressure_meta", { defaultValue: "Tasks that need review before scaling" })}</span>
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
          <Text className="cm-kpi-eyebrow">{t("dashboard.recovery_eyebrow", { defaultValue: "Recovery" })}</Text>
          <h3>{t("dashboard.recovery_title", { defaultValue: "Stabilize the route base" })}</h3>
          <p>{t("dashboard.recovery_copy", { defaultValue: "Review locked inventory, cooldown pressure and routing quality before adding new outbound volume." })}</p>
          <div className="cm-priority-actions">
            <Button onClick={() => navigate("/admin/accounts?status=Dead")}>{t("dashboard.locked_inventory", { defaultValue: "Locked inventory" })}</Button>
            <Button onClick={() => navigate("/admin/accounts?tab=proxy-pool")}>{t("dashboard.proxy_routing", { defaultValue: "Proxy routing" })}</Button>
          </div>
        </div>
        <div className="cm-priority-card">
          <Text className="cm-kpi-eyebrow">{t("dashboard.execution_eyebrow", { defaultValue: "Execution" })}</Text>
          <h3>{t("dashboard.execution_title", { defaultValue: "Keep operators in motion" })}</h3>
          <p>{t("dashboard.execution_copy", { defaultValue: "Move from exceptions into live work by opening the threads that need replies or by reviewing running tasks." })}</p>
          <div className="cm-priority-actions">
            <Button type="primary" className="cm-primary-button" onClick={() => navigate("/admin/conversations")}>
              {t("dashboard.open_conversation_center", { defaultValue: "Open conversation center" })}
            </Button>
            <Button onClick={() => navigate("/admin/tasks")}>{t("dashboard.review_task_flow", { defaultValue: "Review task flow" })}</Button>
          </div>
        </div>
      </div>

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={15}>
          <div className="cm-section-card" style={{ padding: 14 }}>
            <div className="cm-page-header" style={{ marginBottom: 12 }}>
              <div>
                <Text className="cm-kpi-eyebrow">{t("dashboard.execution_capacity", { defaultValue: "Execution Capacity" })}</Text>
                <Title level={4} className="cm-page-title">
                  {t("dashboard.task_throughput", { defaultValue: "Task Throughput" })}
                </Title>
              </div>
              <Text style={{ color: "var(--cm-text-secondary)" }}>
                {t("dashboard.running_of_total", {
                  defaultValue: "{{running}} running of {{total}} total tasks",
                  running: data.runningTasks ?? 0,
                  total: data.totalTasks ?? 0,
                })}
              </Text>
            </div>
            <Row gutter={[16, 16]}>
              <Col xs={24} md={12}>
                <div className="cm-glass-card" style={{ borderRadius: 16, padding: 14 }}>
                  <Text className="cm-kpi-eyebrow">{t("dashboard.completion_rate", { defaultValue: "Completion Rate" })}</Text>
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
                        {t("dashboard.success_quality", { defaultValue: "Success quality across active throughput." })}
                      </Text>
                    </div>
                  </div>
                </div>
              </Col>
              <Col xs={24} md={12}>
                <div className="cm-glass-card" style={{ borderRadius: 16, padding: 14, height: "100%" }}>
                  <Text className="cm-kpi-eyebrow">{t("dashboard.immediate_actions", { defaultValue: "Immediate Actions" })}</Text>
                  <Space direction="vertical" size={10} style={{ width: "100%", marginTop: 12 }}>
                    <Button block onClick={() => navigate("/admin/accounts?status=Dead")}>{t("dashboard.recover_locked_inventory", { defaultValue: "Recover locked inventory" })}</Button>
                    <Button block onClick={() => navigate("/admin/conversations")}>{t("dashboard.prioritize_live_conversations", { defaultValue: "Prioritize live conversations" })}</Button>
                    <Button block type="primary" className="cm-primary-button" onClick={() => navigate("/admin/accounts?tab=proxy-pool")}>
                      {t("dashboard.validate_proxy_routing", { defaultValue: "Validate proxy routing" })}
                    </Button>
                  </Space>
                </div>
              </Col>
            </Row>
          </div>
        </Col>
        <Col xs={24} xl={9}>
          <div className="cm-section-card" style={{ padding: 14, height: "100%" }}>
            <Text className="cm-kpi-eyebrow">{t("dashboard.live_status", { defaultValue: "Live Status" })}</Text>
            <Title level={4} className="cm-page-title" style={{ marginTop: 6 }}>
              {t("dashboard.operational_signals", { defaultValue: "Operational Signals" })}
            </Title>
            <div className="cm-signal-list" style={{ marginTop: 10 }}>
              <div className="cm-signal-item">
                <div>
                  <strong>{t("dashboard.cooldown_accounts", { defaultValue: "Cooldown Accounts" })}</strong>
                  <span>{t("dashboard.cooldown_accounts_meta", { defaultValue: "Accounts temporarily unavailable for new work" })}</span>
                </div>
                <Tag color="orange">{data.cooldownAccounts ?? 0}</Tag>
              </div>
              <div className="cm-signal-item">
                <div>
                  <strong>{t("dashboard.running_tasks", { defaultValue: "Running Tasks" })}</strong>
                  <span>{t("dashboard.running_tasks_meta", { defaultValue: "Current task workload across the system" })}</span>
                </div>
                <Tag color="blue">{data.runningTasks ?? 0}</Tag>
              </div>
              <div className="cm-signal-item">
                <div>
                  <strong>{t("dashboard.last_update", { defaultValue: "Last Update" })}</strong>
                  <span>{t("dashboard.last_update_meta", { defaultValue: "Most recent backend stats refresh" })}</span>
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
