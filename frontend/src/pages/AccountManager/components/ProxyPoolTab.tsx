import React, { useEffect, useState, useMemo } from "react";
import {
  Button,
  Card,
  Collapse,
  Form,
  Input,
  InputNumber,
  message,
  Modal,
  Popconfirm,
  Row,
  Col,
  Select,
  Space,
  Statistic,
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
  GlobalOutlined,
  PlusOutlined,
  ReloadOutlined,
  SettingOutlined,
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
  if (latency == null) return "#b9a19a";
  if (latency < 800) return "#16a34a";
  if (latency <= 1500) return "#d97706";
  return "#c0392b";
};

const ProxyPoolTab: React.FC = () => {
  const { Paragraph, Text } = Typography;
  const { t } = useTranslation();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<ProxyItem[]>([]);
  const [total, setTotal] = useState(0);
  const [proxyText, setProxyText] = useState("");
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

  const addProxies = async () => {
    const proxies = proxyText
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean);

    if (!proxies.length) {
      message.warning(t("proxy.import_required", { defaultValue: "请输入至少一条 IP 代理" }));
      return;
    }

    try {
      const res: any = await api.post("/proxies", { proxies });
      message.success(res?.message || t("proxy.import_success", { defaultValue: "IP 导入成功" }));
      setProxyText("");
      await loadProxies(1, pageSize, currentFilters());
      await loadStatus(true);
    } catch {
      message.error(t("proxy.import_failed", { defaultValue: "IP 导入失败" }));
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

  return (
    <div style={{ width: "100%", padding: "0 4px" }} className="cm-table-shell">
      {/* 页面标题与主操作 */}
      <div style={{ marginBottom: 24, display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 16 }}>
        <div>
          <Typography.Title level={4} style={{ margin: 0, fontWeight: 600 }}>
            {t("proxy.title", { defaultValue: "IP 池管理" })}
          </Typography.Title>
          <Typography.Text type="secondary" style={{ fontSize: 13 }}>
            {t("proxy.subtitle", {
              defaultValue: "管理代理 IP、拉取 API、白名单与调度权重，支持按协议、地区筛选与批量导入。",
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

      {/* 统计卡片 */}
      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col xs={24} sm={12} md={6}>
          <Card size="small" bordered className="cm-glass-card" style={{ borderRadius: 18 }}>
            <Statistic
              title={t("proxy.total_proxy", { defaultValue: "总代理数" })}
              value={statusSummary?.total ?? 0}
              loading={statusLoading && !statusSummary}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card size="small" bordered className="cm-glass-card" style={{ borderRadius: 18, borderLeft: "3px solid #52c41a" }}>
            <Statistic
              title={t("proxy.alive_proxy", { defaultValue: "存活" })}
              value={statusSummary?.alive ?? 0}
              loading={statusLoading && !statusSummary}
              valueStyle={{ color: "#52c41a" }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card size="small" bordered className="cm-glass-card" style={{ borderRadius: 18, borderLeft: "3px solid #ff4d4f" }}>
            <Statistic
              title={t("proxy.dead_proxy", { defaultValue: "不可用" })}
              value={statusSummary?.dead ?? 0}
              loading={statusLoading && !statusSummary}
              valueStyle={{ color: "#ff4d4f" }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card size="small" bordered className="cm-glass-card" style={{ borderRadius: 18, borderLeft: `3px solid ${getLatencyColor(statusSummary?.avgLatencyMs)}` }}>
            <Statistic
              title={t("proxy.avg_latency", { defaultValue: "平均延迟" })}
              value={statusSummary?.avgLatencyMs ?? "—"}
              suffix={statusSummary?.avgLatencyMs != null ? "ms" : ""}
              loading={statusLoading && !statusSummary}
              valueStyle={{ color: getLatencyColor(statusSummary?.avgLatencyMs) }}
            />
          </Card>
        </Col>
      </Row>
      {statusSummary?.checkedAt && (
        <Typography.Text type="secondary" style={{ fontSize: 12, display: "block", marginBottom: 16 }}>
          {t("proxy.last_checked_at_label", { defaultValue: "检测时间：" })}
          {new Date(statusSummary.checkedAt).toLocaleString()}
        </Typography.Text>
      )}

      {/* 代理列表主区域 */}
      <Card
        title={
          <Space>
            <GlobalOutlined />
            <span>{t("proxy.list_title", { defaultValue: "代理列表" })}</span>
          </Space>
        }
        bordered
        style={{ marginBottom: 24, borderRadius: 8 }}
        bodyStyle={{ padding: "16px 24px" }}
      >
        <Space wrap direction="vertical" style={{ width: "100%" }} size={12}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", justifyContent: "space-between" }}>
            <Space wrap size="middle">
              <Button icon={<ReloadOutlined />} onClick={() => loadProxies(page, pageSize, currentFilters())}>
                刷新列表
              </Button>
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
              <Button type="default" onClick={onSearch}>
                {t("proxy.search_button", { defaultValue: "查询" })}
              </Button>
            </Space>
            <Typography.Text type="secondary">
              {t("proxy.total_label", { defaultValue: "共 {{count}} 条", count: total ?? rows.length })}
            </Typography.Text>
          </div>
        </Space>
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
      </Card>

      {/* 高级配置：批量导入 + API 与白名单 */}
      <Collapse
        defaultActiveKey={[]}
        items={[
          {
            key: "batch",
            label: (
              <Space>
                <SettingOutlined />
                <span>{t("proxy.batch_panel_title", { defaultValue: "批量导入 IP" })}</span>
              </Space>
            ),
            children: (
              <Space direction="vertical" style={{ width: "100%" }} size={12}>
                <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                  {t("proxy.batch_help", {
                    defaultValue:
                      "每行一条，支持 protocol://user:pass@host:port 或 host:port:user:pass。",
                  })}
                </Paragraph>
                <Input.TextArea
                  rows={5}
                  placeholder={t("proxy.batch_placeholder", {
                    defaultValue: "http://user:pass@127.0.0.1:8080",
                  })}
                  value={proxyText}
                  onChange={(e) => setProxyText(e.target.value)}
                  style={{ fontFamily: "monospace" }}
                />
                <Space>
                  <Button type="primary" onClick={addProxies}>
                    {t("proxy.batch_import_button", { defaultValue: "导入 IP" })}
                  </Button>
                  <Button onClick={() => setProxyText("")}>
                    {t("proxy.batch_clear_button", { defaultValue: "清空" })}
                  </Button>
                </Space>
              </Space>
            ),
          },
          {
            key: "api",
            label: (
              <Space>
                <ApiOutlined />
                <span>{t("proxy.api_panel_title", { defaultValue: "IP 拉取 API 与白名单" })}</span>
                {configLoading && (
                  <Typography.Text type="secondary">
                    {t("proxy.loading", { defaultValue: "加载中…" })}
                  </Typography.Text>
                )}
              </Space>
            ),
            children: (
              <Space direction="vertical" style={{ width: "100%" }} size={16}>
                <div>
                  <Text strong>
                    <ApiOutlined style={{ marginRight: 8 }} />
                    {t("proxy.fetcher_title", { defaultValue: "IP 拉取 API" })}
                  </Text>
                  <Paragraph type="secondary" style={{ marginTop: 4, marginBottom: 8 }}>
                    {t("proxy.fetcher_desc", {
                      defaultValue: "通过 API 自动拉取最新 IP 列表，并按周期刷新到系统中。",
                    })}
                  </Paragraph>
                  <Space wrap style={{ width: "100%" }}>
                    <Input
                      style={{ width: 320 }}
                      placeholder={t("proxy.fetcher_url_placeholder", { defaultValue: "拉取 API 地址" })}
                      value={fetcherApiUrl}
                      onChange={(e) => setFetcherApiUrl(e.target.value)}
                    />
                    <InputNumber
                      min={1}
                      value={fetcherInterval}
                      onChange={(v) => setFetcherInterval(Number(v || 5))}
                      addonAfter={t("proxy.minutes_suffix", { defaultValue: "分钟" })}
                    />
                    <Input
                      style={{ width: 260 }}
                      placeholder={t("proxy.auth_header_placeholder", {
                        defaultValue: "认证头（可选）",
                      })}
                      value={fetcherAuthHeader}
                      onChange={(e) => setFetcherAuthHeader(e.target.value)}
                    />
                    <Button type="primary" onClick={configureFetcher}>
                      {t("proxy.fetcher_save_button", { defaultValue: "保存拉取配置" })}
                    </Button>
                    <Button icon={<ReloadOutlined />} onClick={refreshProxyPool}>
                      {t("proxy.refresh_now_button", { defaultValue: "立即刷新 IP 池" })}
                    </Button>
                  </Space>
                </div>
                <div>
                  <Text strong>
                    <CloudServerOutlined style={{ marginRight: 8 }} />
                    {t("proxy.whitelist_title", { defaultValue: "白名单 API" })}
                  </Text>
                  <Paragraph type="secondary" style={{ marginTop: 4, marginBottom: 8 }}>
                    {t("proxy.whitelist_desc", {
                      defaultValue: "将当前服务器公网 IP 推送到上游代理白名单。",
                    })}
                  </Paragraph>
                  <Space wrap>
                    <Input
                      style={{ width: 300 }}
                      placeholder={t("proxy.whitelist_url_placeholder", { defaultValue: "白名单 API 地址" })}
                      value={whitelistApiUrl}
                      onChange={(e) => setWhitelistApiUrl(e.target.value)}
                    />
                    <Input
                      style={{ width: 220 }}
                      placeholder={t("proxy.auth_header_placeholder", {
                        defaultValue: "认证头（可选）",
                      })}
                      value={whitelistAuthHeader}
                      onChange={(e) => setWhitelistAuthHeader(e.target.value)}
                    />
                    <Button onClick={configureWhitelist}>
                      {t("proxy.whitelist_save_button", { defaultValue: "保存白名单配置" })}
                    </Button>
                  </Space>
                </div>
                <div>
                  <Text strong>{t("proxy.server_ip_title", { defaultValue: "服务器公网 IP" })}</Text>
                  <Paragraph type="secondary" style={{ marginTop: 4, marginBottom: 8 }}>
                    {t("proxy.server_ip_desc", {
                      defaultValue: "填写后点击「更新白名单」推送到上游。",
                    })}
                  </Paragraph>
                  <Space wrap>
                    <Input
                      style={{ width: 200 }}
                      placeholder={t("proxy.server_ip_placeholder", { defaultValue: "服务器公网 IP" })}
                      value={serverIp}
                      onChange={(e) => setServerIp(e.target.value)}
                    />
                    <Button type="primary" onClick={updateWhitelist}>
                      {t("proxy.server_ip_update_button", { defaultValue: "更新白名单" })}
                    </Button>
                  </Space>
                </div>
              </Space>
            ),
          },
        ]}
        style={{ marginBottom: 24 }}
      />

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
