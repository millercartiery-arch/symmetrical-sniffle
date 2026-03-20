/* -------------------------------------------------------------------------
   src/pages/TaskList.tsx
   ------------------------------------------------------------------------- */
import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useRef,
  FC,
} from "react";
import {
  Table,
  Tag,
  Button,
  Space,
  message,
  Card,
  Typography,
  Tooltip,
  Select,
  Popconfirm,
  Progress,
  theme,
} from "antd";
import {
  ReloadOutlined,
  PauseCircleOutlined,
  SyncOutlined,
  DeleteOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ClockCircleOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";

import api from "../api";

/* -------------------- 1️⃣ Ant Design Theme Token -------------------- */
const { Text, Title } = Typography;
const { Option } = Select;
const { useToken } = theme;

/* -------------------- 2️⃣ Types & Enums -------------------- */
enum TaskStatus {
  Pending = "Pending",
  Processing = "Processing",
  Locked = "LOCKED",
  Sent = "Sent",
  Failed = "Failed",
  Retry = "Retry",
  Paused = "Paused",
  PENDING = "PENDING",
}
interface Task {
  id: string;
  target_phone: string;
  account_phone?: string | null;
  content: string;
  status: TaskStatus | string;
  created_at: string;
}
interface TaskResponse {
  items: Task[];
  total: number;
}
interface Stats {
  total: number;
  sent: number;
  failed: number;
  pending: number;
}
interface Pagination {
  current: number;
  pageSize: number;
  total: number;
}

/* -------------------- 3️⃣ 常量：状态映射 & Select 选项 -------------------- */
const STATUS_MAP: Record<
  string,
  { color: string; icon: React.ReactNode; label: string }
> = {
  Pending: { color: "default", icon: <ClockCircleOutlined />, label: "待处理" },
  PENDING: { color: "default", icon: <ClockCircleOutlined />, label: "待处理" },
  LOCKED: { color: "processing", icon: <SyncOutlined spin />, label: "已分配" },
  Processing: { color: "processing", icon: <SyncOutlined spin />, label: "发送中" },
  Sent: { color: "success", icon: <CheckCircleOutlined />, label: "已发送" },
  Failed: { color: "error", icon: <CloseCircleOutlined />, label: "失败" },
  Retry: { color: "warning", icon: <SyncOutlined />, label: "重试" },
  Paused: { color: "default", icon: <PauseCircleOutlined />, label: "已暂停" },
};

const STATUS_OPTIONS = [
  { value: "All", label: "全部" },
  { value: TaskStatus.Pending, label: "待处理" },
  { value: TaskStatus.Sent, label: "已发送" },
  { value: TaskStatus.Failed, label: "失败" },
];

/* -------------------- 4️⃣ 自定义 Hook：轮询 -------------------- */
function useInterval(callback: () => void, delay: number | null) {
  const savedCallback = useRef(callback);

  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  useEffect(() => {
    if (delay === null) return;
    const id = setInterval(() => savedCallback.current(), delay);
    return () => clearInterval(id);
  }, [delay]);
}

/* -------------------- 5️⃣ 主 Hook：获取任务 & 计算统计 -------------------- */
function useFetchTasks(
  page: number,
  pageSize: number,
  statusFilter: string | undefined,
) {
  const [data, setData] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  const [pagination, setPagination] = useState<Pagination>({
    current: page,
    pageSize,
    total: 0,
  });
  const abortRef = useRef<AbortController | null>(null);

  const fetch = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    try {
      const res: any = await api.get("/tasks", {
        params: {
          page,
          limit: pageSize,
          status: statusFilter === "All" ? undefined : statusFilter,
        },
        signal: controller.signal,
      });
      const items = Array.isArray(res?.items) ? res.items : res?.data?.items ?? [];
      const total = res?.total ?? res?.data?.total ?? 0;
      setData(items);
      setPagination((p) => ({ ...p, total, current: page, pageSize }));
    } catch (err: any) {
      if (err?.name === "CanceledError" || err?.code === "ERR_CANCELED") return;
      console.error(err);
      message.error("加载任务列表失败");
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, statusFilter]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  useInterval(fetch, 5000);

  const stats: Stats = useMemo(() => {
    const s: Stats = { total: pagination.total, sent: 0, failed: 0, pending: 0 };
    data.forEach((t) => {
      const st = t.status as string;
      if (st === TaskStatus.Sent) s.sent++;
      else if (st === TaskStatus.Failed) s.failed++;
      else s.pending++;
    });
    s.total = pagination.total;
    return s;
  }, [data, pagination.total]);

  return {
    data,
    loading,
    pagination,
    setPagination,
    stats,
    refresh: fetch,
  };
}

/* -------------------- 6️⃣ 统计卡组件（复用） -------------------- */
interface StatCardProps {
  title: string;
  value: number;
  color?: string;
}
const StatCard: FC<StatCardProps> = ({ title, value, color }) => {
  const { token } = useToken();
  const cardStyle: React.CSSProperties = {
    flex: 1,
    borderRadius: 12,
    border: "none",
    boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
    padding: 16,
    display: "flex",
    alignItems: "center",
    gap: 16,
  };
  return (
    <Card style={cardStyle}>
      <div style={{ fontSize: 24, fontWeight: 700, color: color ?? token.colorText }}>
        {value}
      </div>
      <div style={{ color: token.colorTextSecondary }}>{title}</div>
    </Card>
  );
};

/* -------------------- 7️⃣ 主组件：TaskList -------------------- */
const TaskList: React.FC = () => {
  const { t } = useTranslation();
  const { token } = useToken();

  const [statusFilter, setStatusFilter] = useState<string | undefined>("All");
  const [pageInfo, setPageInfo] = useState({ current: 1, pageSize: 10 });

  const {
    data,
    loading,
    pagination,
    setPagination,
    stats,
    refresh,
  } = useFetchTasks(pageInfo.current, pageInfo.pageSize, statusFilter);

  const handleTableChange = useCallback(
    (newPagination: any) => {
      const current = newPagination.current ?? 1;
      const pageSize = newPagination.pageSize ?? 10;
      setPageInfo({ current, pageSize });
      setPagination((p) => ({ ...p, current, pageSize }));
    },
    [setPagination],
  );

  const handleRetry = useCallback(async (id: string) => {
    try {
      await api.post(`/tasks/${id}/retry`);
      message.success("任务已重新发送");
      refresh();
    } catch (e) {
      message.error("重试任务失败");
    }
  }, [refresh]);

  const handleRetryAll = useCallback(async () => {
    try {
      await api.post("/tasks/retry-all");
      message.success("已触发全部失败任务的重试");
      refresh();
    } catch (e) {
      message.error("批量重试失败");
    }
  }, [refresh]);

  const handleDelete = useCallback(async (id: string) => {
    try {
      await api.delete(`/tasks/${id}`);
      message.success("任务已删除");
      refresh();
    } catch (e) {
      message.error("删除任务失败");
    }
  }, [refresh]);

  const columns = useMemo(() => {
    const renderStatus = (status: string) => {
      const cfg = STATUS_MAP[status] ?? {
        color: "default",
        icon: <ClockCircleOutlined />,
        label: status,
      };
      return (
        <Tag
          icon={cfg.icon}
          color={cfg.color as any}
          style={{ borderRadius: 12 }}
          aria-label={cfg.label}
        >
          {cfg.label}
        </Tag>
      );
    };

    return [
      {
        title: t("task.target_phone", { defaultValue: "目标号码" }),
        dataIndex: "target_phone",
        render: (text: string) => <Text copyable>{text}</Text>,
      },
      {
        title: t("task.account_phone", { defaultValue: "使用账号" }),
        dataIndex: "account_phone",
        render: (text?: string | null) =>
          text ? (
            <Text copyable type="success">
              {text}
            </Text>
          ) : (
            <Text type="secondary">-</Text>
          ),
      },
      {
        title: t("task.content", { defaultValue: "内容" }),
        dataIndex: "content",
        ellipsis: true,
        width: "40%",
      },
      {
        title: t("task.status", { defaultValue: "状态" }),
        dataIndex: "status",
        width: 120,
        render: renderStatus,
      },
      {
        title: t("task.created_at", { defaultValue: "创建时间" }),
        dataIndex: "created_at",
        render: (text: string) => (
          <Text type="secondary" style={{ fontSize: 12 }}>
            {new Date(text).toLocaleString()}
          </Text>
        ),
      },
      {
        title: t("task.action", { defaultValue: "操作" }),
        key: "action",
        render: (_: any, record: Task) => (
          <Space size="small">
            {record.status === TaskStatus.Failed && (
              <Tooltip title={t("task.retry", { defaultValue: "重试" })}>
                <Button
                  type="text"
                  icon={<SyncOutlined />}
                  onClick={() => handleRetry(record.id)}
                  aria-label={t("task.retry", { defaultValue: "重试" })}
                />
              </Tooltip>
            )}
            <Popconfirm
              title={t("task.delete_confirm", { defaultValue: "确定删除吗？" })}
              onConfirm={() => handleDelete(record.id)}
            >
              <Button
                type="text"
                danger
                icon={<DeleteOutlined />}
                aria-label={t("task.delete", { defaultValue: "删除" })}
              />
            </Popconfirm>
          </Space>
        ),
      },
    ];
  }, [t, handleRetry, handleDelete]);

  return (
    <div style={{ padding: 13, margin: "0 auto" }}>
      <Space style={{ marginBottom: 13, display: "flex", width: "100%" }} size="large">
        <Card
          style={{
            flex: 1,
            borderRadius: 12,
            border: "none",
            boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
            display: "flex",
            alignItems: "center",
            gap: 16,
          }}
        >
          <Progress
            type="circle"
            percent={Math.round((stats.sent / (stats.total || 1)) * 100)}
            width={60}
            strokeColor={token.colorPrimary}
          />
          <div>
            <div style={{ fontSize: 24, fontWeight: 700 }}>{stats.total}</div>
            <div style={{ color: token.colorTextSecondary }}>{t("task.total", { defaultValue: "总任务数" })}</div>
          </div>
        </Card>

        <StatCard
          title={t("task.sent", { defaultValue: "发送成功" })}
          value={stats.sent}
          color={token.colorSuccess}
        />

        <StatCard
          title={t("task.failed", { defaultValue: "发送失败" })}
          value={stats.failed}
          color={token.colorError}
        />
      </Space>

      <Card
        bordered={false}
        style={{
          borderRadius: 12,
          boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
        }}
      >
        <div
          style={{
            marginBottom: 13,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <Title level={4} style={{ margin: 0 }}>
            {t("task.history", { defaultValue: "群发历史" })}
          </Title>

          <Space>
            <Select
              value={statusFilter ?? "All"}
              style={{ width: 140 }}
              onChange={(v) => setStatusFilter(v)}
              allowClear
              placeholder={t("task.filter_status", { defaultValue: "状态筛选" })}
            >
              {STATUS_OPTIONS.map((opt) => (
                <Option key={opt.value} value={opt.value}>
                  {opt.label}
                </Option>
              ))}
            </Select>

            <Button
              icon={<ReloadOutlined />}
              onClick={refresh}
              aria-label={t("common.refresh", { defaultValue: "刷新" })}
            >
              {t("common.refresh", { defaultValue: "刷新" })}
            </Button>

            <Button
              danger
              icon={<SyncOutlined />}
              onClick={handleRetryAll}
              disabled={stats.failed === 0}
              aria-label={t("task.retry_all", { defaultValue: "重试失败任务" })}
            >
              {t("task.retry_all", { defaultValue: "重试失败任务" })}
            </Button>
          </Space>
        </div>

        <Table<Task>
          columns={columns}
          dataSource={data}
          rowKey="id"
          loading={loading}
          pagination={pagination}
          onChange={handleTableChange}
        />
      </Card>
    </div>
  );
};

export default TaskList;
