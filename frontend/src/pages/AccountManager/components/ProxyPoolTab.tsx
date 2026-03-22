import React, { useEffect, useState, useMemo } from "react";
import {
  Button,
  Form,
  Input,
  InputNumber,
  message,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
} from "antd";
import {
  ApiOutlined,
  CloudServerOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  ReloadOutlined,
  SyncOutlined,
} from "@ant-design/icons";
import api from "../../../api";
import { useTranslation } from "react-i18next";

type ProxyStatusSummary = {
  total: number;
  alive: number;
  dead: number;
  avgLatencyMs: number | null;
  checkedAt?: string;
};

type ProxyItem = {
  id: number;
  protocol: string;
  host: string;
  port: number;
  username?: string | null;
  password?: string | null;
  description?: string | null;
  region?: string | null;
  tags?: string[] | null;
  weight?: number | null;
  is_active?: number | null;
  status?: string | null;
  country?: string | null;
  city?: string | null;
  last_checked_at?: string | null;
  last_latency_ms?: number | null;
  last_alive?: number | null;
  last_error_msg?: string | null;
  bind_count?: number;
};

const PROTOCOLS = ["http", "https", "socks4", "socks5"];

const getLatencyColor = (latency: number | null | undefined) => {
  if (latency == null) return "#8b95a7";
  if (latency < 800) return "#16a34a";
  if (latency <= 1500) return "#d97706";
  return "#c61f3a";
};

const ProxyPoolTab: React.FC = () => {
  const { Text } = Typography;
  const { t } = useTranslation();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<ProxyItem[]>([]);
  const [total, setTotal] = useState(0);
  const [fetcherApiUrl, setFetcherApiUrl] = useState("");
  const [fetcherInterval, setFetcherInterval] = useState(5);
  const [whitelistApiUrl, setWhitelistApiUrl] = useState("");
  const [whitelistAuthHeader, setWhitelistAuthHeader] = useState("");
  const [fetcherAuthHeader, setFetcherAuthHeader] = useState("");
  const [serverIp, setServerIp] = useState("");
  const [configLoading, setConfigLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingProxy, setEditingProxy] = useState<ProxyItem | null>(null);
  const [saveLoading, setSaveLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [searchKeyword, setSearchKeyword] = useState("");
  const [protocolFilter, setProtocolFilter] = useState<string>("");
  const [regionFilter, setRegionFilter] = useState<string>("");
  const [enabledFilter, setEnabledFilter] = useState<string>("");
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusSummary, setStatusSummary] = useState<ProxyStatusSummary | null>(null);

  const loadStatus = async (force = false) => {
    setStatusLoading(true);
    try {
      const res: any = await api.get("/system/proxies/status", {
        params: force ? { force: "true" } : undefined,
      });
      const d = res?.data;
      const summary = d?.summary ?? d;
      setStatusSummary({
        total: Number(summary?.total ?? d?.total ?? 0),
        alive: Number(summary?.alive ?? d?.alive ?? 0),
        dead: Number(summary?.dead ?? d?.dead ?? 0),
        avgLatencyMs: summary?.avgLatencyMs ?? d?.avgLatencyMs ?? null,
        checkedAt: d?.checkedAt ?? new Date().toISOString(),
      });
    } catch {
      message.error(t("proxy.status_fetch_failed", { defaultValue: "获取 IP 池状态失败" }));
    } finally {
      setStatusLoading(false);
    }
  };

  const loadProxies = async (p = page, ps = pageSize, filters?: { search?: string; protocol?: string; region?: string; enabled?: string }) => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = { page: p, pageSize: ps };
      if (filters?.search) params.search = filters.search;
      if (filters?.protocol) params.protocol = filters.protocol;
      if (filters?.region) params.region = filters.region;
      if (filters?.enabled !== undefined && filters.enabled !== "") params.enabled = filters.enabled;
      const res: any = await api.get("/proxies", { params });
      // axios 包装器已返回 response.data；后端结构为 { code, data, list, total, pagination }
      const list = res?.data ?? res?.list ?? [];
      setRows(Array.isArray(list) ? list : []);
      setTotal(Number(res?.total ?? res?.pagination?.total ?? (Array.isArray(list) ? list.length : 0)));
      setPage(p);
      setPageSize(ps);
    } catch {
      message.error(t("proxy.list_fetch_failed", { defaultValue: "加载 IP 列表失败" }));
    } finally {
      setLoading(false);
    }
  };

  const loadConfig = async () => {
    setConfigLoading(true);
    try {
      const [fetcherRes, whitelistRes]: any[] = await Promise.all([
        api.get("/proxy/fetcher/config"),
        api.get("/proxy/whitelist/config"),
      ]);
      const fc = fetcherRes?.data ?? fetcherRes;
      if (fc) {
        setFetcherApiUrl(fc.apiUrl ?? "");
        setFetcherInterval(Number(fc.intervalMinutes) || 5);
        setFetcherAuthHeader(fc.authHeader ?? "");
      }
      const wc = whitelistRes?.data ?? whitelistRes;
      if (wc) {
        setWhitelistApiUrl(wc.apiUrl ?? "");
        setWhitelistAuthHeader(wc.authHeader ?? "");
      }
    } catch {
      // 未配置或服务未就绪时忽略
    } finally {
      setConfigLoading(false);
    }
  };

  const currentFilters = () => ({
    search: searchKeyword || undefined,
    protocol: protocolFilter || undefined,
    region: regionFilter || undefined,
    enabled: enabledFilter === "" ? undefined : enabledFilter,
  });

  useEffect(() => {
    loadProxies(1, 20, currentFilters());
    loadConfig();
    loadStatus();
  }, []);

  const configureFetcher = async () => {
    if (!fetcherApiUrl.trim()) {
      message.warning(t("proxy.fetcher_url_required", { defaultValue: "请输入 IP 拉取 API 地址" }));
      return;
    }
    try {
      await api.post("/proxy/fetcher/config", {
        apiUrl: fetcherApiUrl.trim(),
        intervalMinutes: fetcherInterval,
        authHeader: fetcherAuthHeader.trim() || undefined,
      });
      message.success(t("proxy.fetcher_save_success", { defaultValue: "IP 拉取 API 配置成功" }));
    } catch {
      message.error(t("proxy.fetcher_save_failed", { defaultValue: "IP 拉取 API 配置失败" }));
    }
  };

  const configureWhitelist = async () => {
    if (!whitelistApiUrl.trim()) {
      message.warning(t("proxy.whitelist_url_required", { defaultValue: "请输入白名单 API 地址" }));
      return;
    }
    try {
      await api.post("/proxy/whitelist/config", {
        apiUrl: whitelistApiUrl.trim(),
        authHeader: whitelistAuthHeader.trim() || undefined,
      });
      message.success(t("proxy.whitelist_save_success", { defaultValue: "白名单 API 配置成功" }));
    } catch {
      message.error(t("proxy.whitelist_save_failed", { defaultValue: "白名单 API 配置失败" }));
    }
  };

  const updateWhitelist = async () => {
    if (!serverIp.trim()) {
      message.warning(t("proxy.server_ip_required", { defaultValue: "请输入服务器公网 IP" }));
      return;
    }
    try {
      await api.post("/proxy/whitelist/update", { serverIp: serverIp.trim() });
      message.success(t("proxy.whitelist_update_success", { defaultValue: "白名单已更新" }));
    } catch {
      message.error(t("proxy.whitelist_update_failed", { defaultValue: "白名单更新失败" }));
    }
  };

  const refreshProxyPool = async () => {
    try {
      await api.post("/proxy/refresh", {});
      message.success(t("proxy.refresh_success", { defaultValue: "IP 池已刷新" }));
      loadProxies(page, pageSize, currentFilters());
    } catch {
      message.error(t("proxy.refresh_failed", { defaultValue: "IP 池刷新失败" }));
    }
  };

  const checkProxy = async (id: number) => {
    const hide = message.loading(t("proxy.test_loading", { defaultValue: "正在测试连通性…" }), 0);
    try {
      const res: any = await api.post(`/proxies/${id}/test`);
      hide();
      if (res?.data?.ok !== false && res?.ok !== false) {
        message.success(
          t("proxy.test_success", {
            defaultValue: "连通成功，延迟 {{latency}} ms",
            latency: res?.data?.latency ?? res?.latency ?? "—",
          }),
        );
      } else {
        message.error(
          t("proxy.test_failed", {
            defaultValue: "测试失败：{{error}}",
            error: res?.data?.error ?? res?.error ?? "未知",
          }),
        );
      }
      loadProxies(page, pageSize, currentFilters());
    } catch (e: any) {
      hide();
      message.error(
        t("proxy.test_failed", {
          defaultValue: "测试失败：{{error}}",
          error: e?.response?.data?.error ?? e?.message ?? "未知",
        }),
      );
      loadProxies(page, pageSize, currentFilters());
    }
  };

  const openAdd = () => {
    setEditingProxy(null);
    form.resetFields();
    setModalOpen(true);
  };

  const openEdit = (record: ProxyItem) => {
    setEditingProxy(record);
    form.setFieldsValue({
      protocol: record.protocol || "http",
      host: record.host,
      port: record.port,
      username: record.username ?? undefined,
      password: record.password ?? undefined,
      description: record.description ?? undefined,
      region: record.region ?? undefined,
      tags: Array.isArray(record.tags) ? record.tags : (typeof record.tags === "string" ? (record.tags ? [record.tags] : []) : []),
      weight: record.weight ?? 1,
      enabled: record.is_active !== 0,
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    const values = await form.validateFields().catch(() => null);
    if (values == null) return;
    setSaveLoading(true);
    try {
      const payload = {
        protocol: values.protocol,
        host: values.host,
        port: Number(values.port),
        username: values.username || undefined,
        password: values.password || undefined,
        description: values.description || undefined,
        region: values.region || undefined,
        tags: values.tags && values.tags.length ? values.tags : undefined,
        weight: Math.min(100, Math.max(1, Number(values.weight) || 1)),
        enabled: values.enabled !== false,
      };
      if (editingProxy) {
        await api.patch(`/proxies/${editingProxy.id}`, payload);
        message.success(t("proxy.save_updated", { defaultValue: "已更新" }));
      } else {
        await api.post("/proxies", payload);
        message.success(t("proxy.save_created", { defaultValue: "已添加" }));
      }
      setModalOpen(false);
      loadProxies(page, pageSize, currentFilters());
    } catch (e: any) {
      const status = e?.response?.status;
      const msg =
        e?.response?.data?.error ??
        e?.message ??
        t("proxy.save_failed_default", { defaultValue: "保存失败" });
      if (status === 409) {
        message.error(
          t("proxy.save_conflict", {
            defaultValue: "同协议、主机、端口已存在相同用户名的代理，请调整后重试",
          }),
        );
      } else {
        message.error(msg);
      }
    } finally {
      setSaveLoading(false);
    }
  };

  const toggleEnabled = async (record: ProxyItem, enabled: boolean) => {
    try {
      await api.patch(`/proxies/${record.id}`, { enabled });
      message.success(
        enabled
          ? t("proxy.enabled_success", { defaultValue: "已启用" })
          : t("proxy.disabled_success", { defaultValue: "已禁用" }),
      );
      loadProxies(page, pageSize, currentFilters());
    } catch {
      message.error(t("proxy.toggle_failed", { defaultValue: "操作失败" }));
    }
  };

  const deleteProxy = async (id: number) => {
    try {
      await api.delete(`/proxies/${id}`);
      message.success(t("proxy.delete_success", { defaultValue: "IP 已删除" }));
      loadProxies(page, pageSize, currentFilters());
    } catch {
      message.error(t("proxy.delete_failed", { defaultValue: "IP 删除失败" }));
    }
  };

  const onSearch = () => {
    loadProxies(1, pageSize, currentFilters());
  };

  const applyFilters = (overrides?: { protocol?: string; region?: string; enabled?: string }) => {
    const f = { ...currentFilters(), ...overrides };
    if (overrides?.protocol !== undefined) setProtocolFilter(overrides.protocol ?? "");
    if (overrides?.region !== undefined) setRegionFilter(overrides.region ?? "");
    if (overrides?.enabled !== undefined) setEnabledFilter(overrides.enabled ?? "");
    loadProxies(1, pageSize, f);
  };

  const columns = useMemo(
    () => [
    { title: t("proxy.col_protocol", { defaultValue: "协议" }), dataIndex: "protocol", width: 80 },
    {
      title: t("proxy.col_address", { defaultValue: "代理地址" }),
      key: "addr",
      width: 160,
      render: (_: any, r: ProxyItem) => `${r.host}:${r.port}`,
    },
    {
      title: t("proxy.col_description", { defaultValue: "描述" }),
      dataIndex: "description",
      width: 120,
      ellipsis: true,
      render: (v: string) => v || "-",
    },
    {
      title: t("proxy.col_tags", { defaultValue: "标签" }),
      dataIndex: "tags",
      width: 100,
      render: (tags: string[] | string | null) =>
        Array.isArray(tags) ? tags.map((t) => <Tag key={t}>{t}</Tag>) : typeof tags === "string" ? tags : "-",
    },
    {
      title: t("proxy.col_weight", { defaultValue: "权重" }),
      dataIndex: "weight",
      width: 64,
      render: (v: number) => v ?? 1,
    },
    {
      title: t("proxy.col_enabled", { defaultValue: "状态" }),
      dataIndex: "is_active",
      width: 88,
      render: (enabled: number | null, record: ProxyItem) => (
        <Switch
          checked={enabled !== 0}
          onChange={(checked) => toggleEnabled(record, checked)}
          size="small"
        />
      ),
    },
    {
      title: t("proxy.col_bind_count", { defaultValue: "绑定数" }),
      dataIndex: "bind_count",
      width: 80,
      render: (v: number | null) => (v != null && v > 0 ? <Tag color="blue">{v}</Tag> : "0"),
    },
    {
      title: t("proxy.col_region", { defaultValue: "地区" }),
      key: "region",
      width: 100,
      render: (_: unknown, r: ProxyItem) => [r.region, r.country, r.city].filter(Boolean).join(" / ") || "-",
    },
    {
      title: t("proxy.col_latency", { defaultValue: "延迟" }),
      dataIndex: "last_latency_ms",
      width: 72,
      render: (v: number | null) => (
        <span style={{ color: getLatencyColor(v), fontWeight: 600 }}>
          {v != null ? `${v} ms` : "-"}
        </span>
      ),
    },
    {
      title: t("proxy.col_last_check", { defaultValue: "最后检测" }),
      dataIndex: "last_checked_at",
      width: 140,
      render: (value: string, r: ProxyItem) =>
        value ? (
          <span title={r.last_error_msg || undefined}>
            {new Date(value).toLocaleString()}
            {r.last_error_msg && " ⚠"}
          </span>
        ) : "-",
    },
    {
      title: t("proxy.col_actions", { defaultValue: "操作" }),
      width: 200,
      fixed: "right" as const,
      render: (_: any, record: ProxyItem) => (
        <Space size="small">
          <Button size="small" type="text" shape="circle" icon={<EditOutlined />} onClick={() => openEdit(record)} />
          <Button size="small" type="text" shape="circle" icon={<SyncOutlined />} onClick={() => checkProxy(record.id)} />
          <Popconfirm
            title={t("proxy.delete_confirm_title", { defaultValue: "确认软删除此代理？" })}
            description={t("proxy.delete_confirm_desc", {
              defaultValue: "删除后该代理将不再可用，已绑定的子账号会自动解除绑定。",
            })}
            onConfirm={() => deleteProxy(record.id)}
          >
            <Button size="small" type="text" danger shape="circle" icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ], [t]);

  const proxySummary = [
    {
      key: "total",
      label: t("proxy.total_proxy", { defaultValue: "总代理数" }),
      value: statusSummary?.total ?? 0,
      meta: t("proxy.total_label", { defaultValue: "共 {{count}} 条", count: total ?? rows.length }),
      tone: "cooldown",
    },
    {
      key: "alive",
      label: t("proxy.alive_proxy", { defaultValue: "存活" }),
      value: statusSummary?.alive ?? 0,
      meta: t("proxy.refresh_status", { defaultValue: "刷新状态" }),
      tone: "ready",
    },
    {
      key: "dead",
      label: t("proxy.dead_proxy", { defaultValue: "不可用" }),
      value: statusSummary?.dead ?? 0,
      meta: t("proxy.filter_status", { defaultValue: "状态筛选" }),
      tone: (statusSummary?.dead ?? 0) > 0 ? "dead" : "ready",
    },
    {
      key: "latency",
      label: t("proxy.avg_latency", { defaultValue: "平均延迟" }),
      value: statusSummary?.avgLatencyMs != null ? `${statusSummary.avgLatencyMs} ms` : "—",
      meta: statusSummary?.checkedAt
        ? `${t("proxy.last_checked_at_label", { defaultValue: "检测时间：" })}${new Date(statusSummary.checkedAt).toLocaleTimeString()}`
        : t("dashboard.awaiting_first_sync", { defaultValue: "Awaiting first sync" }),
      tone: statusSummary?.avgLatencyMs != null && statusSummary.avgLatencyMs > 1500 ? "dead" : "cooldown",
    },
  ];

  return (
    <div style={{ width: "100%", padding: "0 4px" }} className="cm-table-shell">
      <div className="cm-page-header cm-page-header--dashboard" style={{ marginBottom: 16 }}>
        <div>
          <Typography.Title level={4} className="cm-page-title" style={{ margin: 0 }}>
            {t("proxy.title", { defaultValue: "IP 池管理" })}
          </Typography.Title>
          <Typography.Text type="secondary" style={{ fontSize: 13 }}>
            {t("proxy.subtitle", {
              defaultValue: "先看存活与延迟，再处理列表和配置。",
            })}
          </Typography.Text>
        </div>
        <Space wrap>
          <Button
            icon={<SyncOutlined spin={statusLoading} />}
            onClick={() => loadStatus(true)}
            loading={statusLoading}
          >
            {t("proxy.refresh_status", { defaultValue: "刷新状态" })}
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openAdd}>
            {t("proxy.add_proxy", { defaultValue: "新增代理" })}
          </Button>
        </Space>
      </div>

      <div className="cm-summary-metrics" style={{ marginBottom: 16 }}>
        {proxySummary.map((item) => (
          <div key={item.key} className={`cm-summary-metric cm-summary-metric--${item.tone}`}>
            <span className="cm-summary-metric__label">{item.label}</span>
            <strong className="cm-summary-metric__value">{item.value}</strong>
            <span className="cm-summary-metric__meta">{item.meta}</span>
          </div>
        ))}
      </div>

      <div className="cm-section-card" style={{ padding: 14, marginBottom: 18 }}>
        <div className="cm-page-header" style={{ marginBottom: 12 }}>
          <div>
            <div className="cm-kpi-eyebrow">{t("proxy.list_title", { defaultValue: "代理列表" })}</div>
            <Typography.Text type="secondary">
              {t("proxy.total_label", { defaultValue: "共 {{count}} 条", count: total ?? rows.length })}
            </Typography.Text>
          </div>
        </div>

        <div className="cm-toolbar-shell">
          <div className="cm-toolbar-group">
              <Input.Search
                placeholder={t("proxy.search_placeholder", { defaultValue: "搜索主机/描述/地区" })}
                allowClear
                style={{ width: 200 }}
                value={searchKeyword}
                onChange={(e) => setSearchKeyword(e.target.value)}
                onSearch={onSearch}
              />
              <Select
                placeholder={t("proxy.filter_protocol", { defaultValue: "协议" })}
                style={{ width: 100 }}
                allowClear
                value={protocolFilter || undefined}
                onChange={(v) => applyFilters({ protocol: v ?? "" })}
                options={[{ label: "全部", value: "" }, ...PROTOCOLS.map((p) => ({ label: p, value: p }))]}
              />
              <Input
                placeholder={t("proxy.filter_region", { defaultValue: "地区" })}
                style={{ width: 120 }}
                value={regionFilter}
                onChange={(e) => setRegionFilter(e.target.value)}
                onPressEnter={() => onSearch()}
                allowClear
              />
              <Select
                placeholder={t("proxy.filter_status", { defaultValue: "状态" })}
                style={{ width: 90 }}
                allowClear
                value={enabledFilter || undefined}
                onChange={(v) => applyFilters({ enabled: v ?? "" })}
                options={[
                  { label: t("proxy.filter_all", { defaultValue: "全部" }), value: "" },
                  { label: t("proxy.filter_enabled", { defaultValue: "启用" }), value: "true" },
                  { label: t("proxy.filter_disabled", { defaultValue: "禁用" }), value: "false" },
                ]}
              />
              <Button onClick={onSearch}>
                {t("proxy.search_button", { defaultValue: "查询" })}
              </Button>
          </div>

          <div className="cm-toolbar-group cm-toolbar-group--actions">
            <Button icon={<ReloadOutlined />} onClick={() => loadProxies(page, pageSize, currentFilters())}>
              {t("common.refresh", { defaultValue: "刷新" })}
            </Button>
          </div>
        </div>

        <Table
          rowKey="id"
          loading={loading}
          columns={columns as any}
          dataSource={rows}
          pagination={{
            current: page,
            pageSize,
            total: total ?? rows.length,
            showSizeChanger: true,
            showTotal: (tCount) =>
              t("proxy.pagination_total", { defaultValue: "共 {{count}} 条", count: tCount as number }),
            onChange: (p, ps) => loadProxies(p, ps ?? pageSize, currentFilters()),
          }}
          scroll={{ x: 1200 }}
          style={{ marginTop: 16 }}
        />
      </div>

      <div className="cm-task-grid" style={{ marginBottom: 24 }}>
        <div className="cm-task-card">
          <div className="cm-task-card__head">
            <div>
              <span className="cm-kpi-eyebrow">{t("proxy.task_step_one", { defaultValue: "步骤 1" })}</span>
              <Typography.Title level={5} style={{ margin: "6px 0 0" }}>
                <Space size={8}>
                  <ApiOutlined />
                  <span>{t("proxy.fetcher_title", { defaultValue: "IP 拉取 API" })}</span>
                </Space>
              </Typography.Title>
            </div>
            {configLoading ? (
              <Text type="secondary">{t("proxy.loading", { defaultValue: "加载中…" })}</Text>
            ) : null}
          </div>
          <Text type="secondary" className="cm-task-card__copy">
            {t("proxy.fetcher_desc", {
              defaultValue: "保存 API 地址后可自动拉取代理，并按周期刷新。",
            })}
          </Text>
          <div className="cm-task-card__stack">
            <Input
              placeholder={t("proxy.fetcher_url_placeholder", { defaultValue: "拉取 API 地址" })}
              value={fetcherApiUrl}
              onChange={(e) => setFetcherApiUrl(e.target.value)}
            />
            <div className="cm-task-card__row">
              <InputNumber
                min={1}
                value={fetcherInterval}
                onChange={(v) => setFetcherInterval(Number(v || 5))}
                addonAfter={t("proxy.minutes_suffix", { defaultValue: "分钟" })}
                style={{ minWidth: 120 }}
              />
              <Input
                placeholder={t("proxy.auth_header_placeholder", {
                  defaultValue: "认证头（可选）",
                })}
                value={fetcherAuthHeader}
                onChange={(e) => setFetcherAuthHeader(e.target.value)}
              />
            </div>
          </div>
          <div className="cm-task-card__actions">
            <Button type="primary" onClick={configureFetcher}>
              {t("proxy.fetcher_save_button", { defaultValue: "保存拉取配置" })}
            </Button>
            <Button icon={<ReloadOutlined />} onClick={refreshProxyPool}>
              {t("proxy.refresh_now_button", { defaultValue: "立即刷新 IP 池" })}
            </Button>
          </div>
        </div>

        <div className="cm-task-card">
          <div className="cm-task-card__head">
            <div>
              <span className="cm-kpi-eyebrow">{t("proxy.task_step_two", { defaultValue: "步骤 2" })}</span>
              <Typography.Title level={5} style={{ margin: "6px 0 0" }}>
                <Space size={8}>
                  <CloudServerOutlined />
                  <span>{t("proxy.whitelist_title", { defaultValue: "白名单更新" })}</span>
                </Space>
              </Typography.Title>
            </div>
          </div>
          <Text type="secondary" className="cm-task-card__copy">
            {t("proxy.whitelist_desc", {
              defaultValue: "先保存上游白名单接口，再提交当前服务器公网 IP。",
            })}
          </Text>
          <div className="cm-task-card__stack">
            <Input
              placeholder={t("proxy.whitelist_url_placeholder", { defaultValue: "白名单 API 地址" })}
              value={whitelistApiUrl}
              onChange={(e) => setWhitelistApiUrl(e.target.value)}
            />
            <Input
              placeholder={t("proxy.auth_header_placeholder", {
                defaultValue: "认证头（可选）",
              })}
              value={whitelistAuthHeader}
              onChange={(e) => setWhitelistAuthHeader(e.target.value)}
            />
            <div className="cm-task-card__row">
              <Input
                placeholder={t("proxy.server_ip_placeholder", { defaultValue: "服务器公网 IP" })}
                value={serverIp}
                onChange={(e) => setServerIp(e.target.value)}
              />
              <Button onClick={configureWhitelist}>
                {t("proxy.whitelist_save_button", { defaultValue: "保存接口" })}
              </Button>
              <Button type="primary" onClick={updateWhitelist}>
                {t("proxy.server_ip_update_button", { defaultValue: "更新白名单" })}
              </Button>
            </div>
          </div>
        </div>
      </div>

      <Modal
        title={
          editingProxy
            ? t("proxy.modal_edit_title", { defaultValue: "编辑代理" })
            : t("proxy.modal_create_title", { defaultValue: "新增代理" })
        }
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleSave}
        confirmLoading={saveLoading}
        destroyOnClose
        width={480}
      >
        <Form form={form} layout="vertical" initialValues={{ protocol: "http", weight: 1, enabled: true }}>
          <div className="cm-form-grid">
            <Form.Item
              name="protocol"
              label={t("proxy.form_protocol", { defaultValue: "协议" })}
              rules={[{ required: true }]}
            >
              <Select options={PROTOCOLS.map((p) => ({ label: p, value: p }))} />
            </Form.Item>
            <Form.Item
              name="host"
              label={t("proxy.form_host", { defaultValue: "主机" })}
              rules={[{ required: true }]}
            >
              <Input placeholder={t("proxy.form_host_placeholder", { defaultValue: "IP 或域名" })} />
            </Form.Item>
            <Form.Item
              name="port"
              label={t("proxy.form_port", { defaultValue: "端口" })}
              rules={[{ required: true }, { type: "number", min: 1, max: 65535 }]}
            >
              <InputNumber
                style={{ width: "100%" }}
                placeholder={t("proxy.form_port_placeholder", { defaultValue: "1-65535" })}
              />
            </Form.Item>
            <Form.Item name="username" label={t("proxy.form_username", { defaultValue: "用户名" })}>
              <Input placeholder={t("proxy.form_optional_placeholder", { defaultValue: "可选" })} />
            </Form.Item>
            <Form.Item name="password" label={t("proxy.form_password", { defaultValue: "密码" })}>
              <Input.Password placeholder={t("proxy.form_optional_placeholder", { defaultValue: "可选" })} />
            </Form.Item>
            <Form.Item name="description" label={t("proxy.form_description", { defaultValue: "描述" })}>
              <Input placeholder={t("proxy.form_optional_placeholder", { defaultValue: "可选" })} />
            </Form.Item>
            <Form.Item name="region" label={t("proxy.form_region", { defaultValue: "地区" })}>
              <Input
                placeholder={t("proxy.form_region_placeholder", { defaultValue: "如 shanghai，用于路由" })}
              />
            </Form.Item>
            <Form.Item name="tags" label={t("proxy.form_tags", { defaultValue: "标签" })}>
              <Select
                mode="tags"
                placeholder={t("proxy.form_tags_placeholder", { defaultValue: "输入后回车添加" })}
                tokenSeparators={[","]}
              />
            </Form.Item>
          </div>
          <Form.Item
            name="weight"
            label={t("proxy.form_weight", { defaultValue: "权重" })}
            rules={[{ type: "number", min: 1, max: 100 }]}
          >
            <InputNumber style={{ width: "100%" }} min={1} max={100} />
          </Form.Item>
          <Form.Item
            name="enabled"
            label={t("proxy.form_enabled", { defaultValue: "启用" })}
            valuePropName="checked"
          >
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default ProxyPoolTab;
