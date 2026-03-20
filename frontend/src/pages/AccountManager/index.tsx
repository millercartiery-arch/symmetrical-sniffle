import React, { useState, useEffect, useMemo } from 'react';
import { Layout, Tabs, message, Button } from 'antd';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import { DatabaseOutlined, EditOutlined, LinkOutlined, RocketOutlined, ThunderboltOutlined } from '@ant-design/icons';
import api from '../../api';
import AccountsTab from './components/AccountsTab';
import SubAccountsTab from './components/SubAccountsTab';
import ExportFieldsModal from './components/ExportFieldsModal';
import ActivateCardModal from './components/ActivateCardModal';
import AccountConfigDrawer from './components/AccountConfigDrawer';
import ProxyPoolTab from './components/ProxyPoolTab';
import { useSelectionStyle } from '../../hooks/useSelectionStyle';
import StatusTag from '../../components/Common/StatusTag';
import { getSocket } from '../../utils/socket';
import type { PaginationProps } from 'antd';
import type { ColumnsType } from 'antd/es/table';

const { Content } = Layout;

const AccountManager: React.FC = () => {
  const { t } = useTranslation();
  const td = useMemo(
    () => (key: string, fallback: string, options: Record<string, any> = {}) =>
      t(key, { defaultValue: fallback, ...options }),
    [t],
  );
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const [activeTab, setActiveTab] = useState(params.get('tab') || 'accounts');

  const [accounts, setAccounts] = useState<any[]>([]);
  const [accLoading, setAccLoading] = useState(false);
  const [accPagination, setAccPagination] = useState<PaginationProps>({ current: 1, pageSize: 20, total: 0 });
  const [searchText, setSearchText] = useState('');
  const [accountStatusFilter, setAccountStatusFilter] = useState(params.get('status') || 'all');

  const [subAccounts, setSubAccounts] = useState<any[]>([]);
  const [subAccLoading, setSubAccLoading] = useState(false);
  const [subAccPagination, setSubAccPagination] = useState({ current: 1, pageSize: 20, total: 0 });
  const [subAccountFilters, setSubAccountFilters] = useState<{ status?: string; region?: string; proxy_id?: string }>({});

  const [modals, setModals] = useState({
    exportFields: false,
    activateCard: false,
    accountConfig: false,
  });
  const [selectedAccount, setSelectedAccount] = useState<any>(null);
  const [selectedExportFields, setSelectedExportFields] = useState<string[]>(['phone', 'username', 'password', 'token', 'proxy_url']);
  const [exportFormat, setExportFormat] = useState<'csv' | 'json'>('csv');

  const { selectedKeys, setSelectedKeys, handleMouseEnter, handleMouseLeave, getSelectionClass } = useSelectionStyle(accounts);

  useEffect(() => {
    const nextParams = new URLSearchParams(location.search);
    const tab = nextParams.get('tab');
    const status = nextParams.get('status');
    if (tab && tab !== activeTab) setActiveTab(tab);
    if (status && status !== accountStatusFilter) setAccountStatusFilter(status);
  }, [location.search, activeTab, accountStatusFilter]);

  const fetchAccounts = async () => {
    setAccLoading(true);
    try {
      const res: any = await api.get('/accounts', {
        params: {
          page: accPagination.current,
          limit: accPagination.pageSize,
          status: accountStatusFilter === 'all' ? undefined : accountStatusFilter,
          search: searchText || undefined,
        },
      });
      setAccounts(Array.isArray(res?.items) ? res.items : []);
      setAccPagination((prev) => ({ ...prev, total: res?.pagination?.total ?? 0 }));
    } catch (err: any) {
      message.error(td('accounts.fetch_failed', '获取账号失败'));
    } finally {
      setAccLoading(false);
    }
  };

  const fetchSubAccounts = async (page = subAccPagination.current, pageSize = subAccPagination.pageSize) => {
    setSubAccLoading(true);
    try {
      const res: any = await api.get('/sub-accounts', {
        params: {
          page,
          limit: pageSize,
          status: subAccountFilters.status,
          region: subAccountFilters.region,
          proxy_id: subAccountFilters.proxy_id,
        },
      });
      setSubAccounts(Array.isArray(res?.items) ? res.items : []);
      const pag = res?.pagination ?? {};
      setSubAccPagination((prev) => ({
        ...prev,
        current: pag.page ?? page,
        pageSize: pag.limit ?? pageSize,
        total: pag.total ?? 0,
      }));
    } catch (err: any) {
      message.error(td('accounts.fetch_failed', '获取账号失败'));
    } finally {
      setSubAccLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'accounts') fetchAccounts();
    else if (activeTab === 'sub-accounts') fetchSubAccounts();
  }, [activeTab, accPagination.current, accPagination.pageSize, subAccPagination.current, subAccPagination.pageSize, accountStatusFilter, searchText, subAccountFilters.status, subAccountFilters.region, subAccountFilters.proxy_id]);

  useEffect(() => {
    if (activeTab !== 'accounts') return;
    const socket = getSocket();
    const handleAccountUpdate = (payload: any) => {
      setAccounts((prev) =>
        prev.map((acc) => (acc.id === payload.id ? { ...acc, ...payload } : acc))
      );
    };
    socket.on('account:update', handleAccountUpdate);
    return () => {
      socket.off('account:update', handleAccountUpdate);
    };
  }, [activeTab]);

  const openModal = (name: keyof typeof modals) => setModals((prev) => ({ ...prev, [name]: true }));
  const closeModal = (name: keyof typeof modals) => setModals((prev) => ({ ...prev, [name]: false }));

  const selectAllAcrossPages = async () => {
    const hide = message.loading(td('accounts.loading_all_ids', '正在加载全部账号 ID...'), 0);
    try {
      const res: any = await api.get('/accounts/ids', {
        params: {
          status: accountStatusFilter === 'all' ? undefined : accountStatusFilter,
          search: searchText || undefined,
        },
      });
      if (res && Array.isArray(res.ids)) {
        setSelectedKeys(res.ids);
        message.success(
          td('accounts.selected_all_records', '已选中 {{count}} 条记录', { count: res.ids.length })
        );
      }
    } catch (err) {
      message.error(td('accounts.select_all_failed', '全选失败'));
    } finally {
      hide();
    }
  };

  const exportWithSelectedFields = async () => {
    if (selectedExportFields.length === 0) {
      message.warning(td('accounts.select_export_field_required', '请至少选择一个导出字段'));
      return;
    }
    let dataToExport = accounts;
    const total = (accPagination.total as number) ?? 0;
    if (total > accounts.length) {
      const hide = message.loading(td('accounts.loading_full_export_data', '正在加载完整导出数据...'), 0);
      try {
        const res: any = await api.get('/accounts', {
          params: {
            page: 1,
            limit: 1000,
            search: searchText || undefined,
            status: accountStatusFilter === 'all' ? undefined : accountStatusFilter,
          },
        });
        dataToExport = Array.isArray(res?.items) ? res.items : accounts;
      } catch (err) {
        message.warning(
          td('accounts.export_current_page_only', '仅导出当前页数据')
        );
      } finally {
        hide();
      }
    }
    const picked = dataToExport.map((acc) => {
      const row: Record<string, any> = {};
      selectedExportFields.forEach((k) => {
        row[k] = acc?.[k] ?? '';
      });
      return row;
    });
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    let blob: Blob;
    let filename: string;
    if (exportFormat === 'csv') {
      const escapeCsv = (v: any) => {
        const s = String(v ?? '');
        if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
        return s;
      };
      const header = selectedExportFields.join(',');
      const rows = picked.map((row) => selectedExportFields.map((k) => escapeCsv(row[k])).join(','));
      blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv;charset=utf-8' });
      filename = `tn_accounts_export_${ts}.csv`;
    } else {
      blob = new Blob([JSON.stringify(picked, null, 2)], { type: 'application/json;charset=utf-8' });
      filename = `tn_accounts_export_${ts}.json`;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    closeModal('exportFields');
    message.success(
      td('accounts.export_completed', '导出完成：{{filename}}（{{count}} 条）', { filename, count: picked.length })
    );
    api.post('/audit/log', {
      action: 'EXPORT',
      details: { filename, count: picked.length, fields: selectedExportFields, format: exportFormat },
    }).catch(console.error);
  };

  const accountColumns: ColumnsType<any> = [
    { title: 'ID', dataIndex: 'id', width: 80, className: 'text-xs opacity-60' },
    { title: td('accounts.phone', '手机号'), dataIndex: 'phone', render: (val: string) => <span className="font-mono">{val}</span> },
    {
      title: td('accounts.sent_daily_max', '今日发送 / 上限'),
      render: (_: any, rec: any) => (
        <span className="font-mono">{rec.today_sent || 0} / {rec.daily_limit || 25}</span>
      ),
    },
    {
      title: td('accounts.total_sent_recv', '累计发送 / 接收'),
      render: (_: any, rec: any) => (
        <span className="font-mono">{rec.sent_count || 0} / {rec.received_count || 0}</span>
      ),
    },
    {
      title: td('accounts.cooldown_status', '冷却状态'),
      dataIndex: 'status',
      render: (status: string, rec: any) => {
        if (status === 'Cooldown' && rec.cooldown_end) {
          const end = new Date(rec.cooldown_end).getTime();
          const now = Date.now();
          const diff = end - now;
          if (diff > 0) {
            const h = Math.floor(diff / 3600000);
            const m = Math.floor((diff % 3600000) / 60000);
            const s = Math.floor((diff % 60000) / 1000);
            return (
              <span style={{ color: '#fa8c16' }}>
                {td('accounts.cooldown_remaining', '冷却剩余 {{h}}时{{m}}分{{s}}秒', { h, m, s })}
              </span>
            );
          }
        }
        return <StatusTag type="account" status={status} />;
      },
    },
    { title: td('accounts.tn_ready', 'TN 协议'), dataIndex: 'tn_ready', render: (val: number) => <StatusTag type="number" status={val ? 'Ready' : 'Dead'} /> },
    { title: td('accounts.updated_at', '更新时间'), dataIndex: 'updated_at', render: (val: string) => new Date(val).toLocaleString() },
    {
      title: td('common.action', '操作'),
      render: (_: any, record: any) => (
        <Button
          size="small"
          shape="circle"
          icon={<EditOutlined />}
          onClick={async () => {
            try {
              await api.post(`/accounts/${record.id}/lock`);
              setSelectedAccount(record);
              openModal('accountConfig');
            } catch (err: any) {
              if (err.response?.status === 409) {
                message.error(
                  td('accounts.locked_by_other_user', '已被 {{user}} 锁定', { user: err.response.data.user })
                );
              } else {
                message.error(td('accounts.lock_failed_generic', '锁定账号失败'));
              }
            }
          }}
        />
      ),
    },
  ];

  const tWithDefault = (key: string, opts?: { defaultValue?: string }) =>
    (opts?.defaultValue ? t(key, opts) : t(key)) as string;

  const inventoryStats = useMemo(() => {
    const total = Number(accPagination.total ?? accounts.length ?? 0);
    const ready = accounts.filter((item) => String(item.status).toLowerCase() === 'ready').length;
    const cooldown = accounts.filter((item) => String(item.status).toLowerCase() === 'cooldown').length;
    const tnReady = accounts.filter((item) => Number(item.tn_ready) > 0).length;
    return { total, ready, cooldown, tnReady };
  }, [accPagination.total, accounts]);

  const inventoryFocus =
    inventoryStats.tnReady === 0
      ? {
          title: td('accounts.focus.protocol_not_ready_title', '协议未就绪'),
          copy: td('accounts.focus.protocol_not_ready_copy', '先检查代理和账号绑定，确保至少有一个 Ready + proxy 账号。'),
          action: td('accounts.focus.review_proxy_pool', '查看代理池'),
          onClick: () => setActiveTab('proxy-pool'),
        }
      : inventoryStats.cooldown > inventoryStats.ready
        ? {
            title: td('accounts.focus.recovery_title', '库存需要恢复'),
            copy: td('accounts.focus.recovery_copy', '冷却账号偏多，先回到库存页排查异常项。'),
            action: td('accounts.focus.review_inventory', '查看库存'),
            onClick: () => setActiveTab('accounts'),
          }
        : {
            title: td('accounts.focus.healthy_title', '库存健康'),
            copy: td('accounts.focus.healthy_copy', '当前可用库存正常，可以直接导出干净资源。'),
            action: td('accounts.focus.export_clean_inventory', '导出干净库存'),
            onClick: () => openModal('exportFields'),
          };

  return (
    <Content className="cm-page" style={{ padding: 16 }}>
        <div className="cm-page-header">
        <div>
          <div className="cm-kpi-eyebrow">{td('accounts.page_eyebrow', '资源管理')}</div>
          <h1 className="cm-page-title cm-brand-title" style={{ fontSize: 32 }}>
            {td('accounts.page_title', '资源与路由控制台')}
          </h1>
          <div className="cm-page-subtitle">
            {td('accounts.page_subtitle', '资源库存、子账号激活和代理调度都收在同一个工作台里。')}
          </div>
        </div>
      </div>

      <div className="cm-hero-band">
        <div className="cm-hero-panel">
          <div className="cm-kpi-eyebrow">{td('accounts.inventory_command', '库存指令')}</div>
          <h2 className="cm-page-title" style={{ fontSize: 28, marginTop: 8 }}>
            {inventoryFocus.title}
          </h2>
          <div className="cm-page-subtitle" style={{ marginTop: 8 }}>
            {inventoryFocus.copy}
          </div>
          <div className="cm-priority-actions">
            <Button type="primary" className="cm-primary-button" onClick={inventoryFocus.onClick}>
              {inventoryFocus.action}
            </Button>
            <Button onClick={() => setActiveTab('accounts')}>{td('accounts.inspect_inventory', '查看库存')}</Button>
            <Button onClick={() => setActiveTab('sub-accounts')}>{td('accounts.open_sub_accounts', '打开子账号')}</Button>
          </div>
          <div className="cm-hero-metrics">
            <div className="cm-mini-stat">
              <div className="cm-kpi-eyebrow">{td('accounts.visible_inventory', '当前可见库存')}</div>
              <strong>{inventoryStats.total}</strong>
              <span>{td('accounts.visible_inventory_meta', '正在展示的账号总数')}</span>
            </div>
            <div className="cm-mini-stat">
              <div className="cm-kpi-eyebrow">{td('accounts.ready_pool', 'Ready 池')}</div>
              <strong>{inventoryStats.ready}</strong>
              <span>{td('accounts.ready_pool_meta', '可直接调度的账号')}</span>
            </div>
            <div className="cm-mini-stat">
              <div className="cm-kpi-eyebrow">{td('accounts.cooldown_pressure', '冷却压力')}</div>
              <strong>{inventoryStats.cooldown}</strong>
              <span>{td('accounts.cooldown_pressure_meta', '处于冷却中的账号')}</span>
            </div>
            <div className="cm-mini-stat">
              <div className="cm-kpi-eyebrow">{td('accounts.tn_protocol_ready', 'TN 协议就绪')}</div>
              <strong>{inventoryStats.tnReady}</strong>
              <span>{td('accounts.tn_protocol_ready_meta', '可进入发送调度的账号')}</span>
            </div>
          </div>
        </div>

        <div className="cm-hero-panel">
          <div className="cm-kpi-eyebrow">{td('accounts.operator_guidance', '操作提示')}</div>
          <div className="cm-signal-list" style={{ marginTop: 16 }}>
            <div className="cm-signal-item">
              <div>
                <strong>{td('accounts.guidance_refresh_title', '刷新列表')}</strong>
                <span>{td('accounts.guidance_refresh_copy', '先同步最新账号状态，再继续后续操作。')}</span>
              </div>
              <Button size="small" onClick={fetchAccounts}>{td('common.refresh', '刷新')}</Button>
            </div>
            <div className="cm-signal-item">
              <div>
                <strong>{td('accounts.guidance_clean_title', '清理就绪库存')}</strong>
                <span>{td('accounts.guidance_clean_copy', '优先查看 Ready 账号，减少不可用项干扰。')}</span>
              </div>
              <Button size="small" onClick={() => setAccountStatusFilter('Ready')}>{td('accounts.show_ready', '只看 Ready')}</Button>
            </div>
            <div className="cm-signal-item">
              <div>
                <strong>{td('accounts.guidance_proxy_title', '检查代理池')}</strong>
                <span>{td('accounts.guidance_proxy_copy', '确认账号代理已绑定且出口稳定。')}</span>
              </div>
              <Button size="small" onClick={() => setActiveTab('proxy-pool')}>{td('accounts.open_proxy_pool', '打开代理池')}</Button>
            </div>
          </div>
        </div>
      </div>

      <div className="cm-feature-grid" style={{ marginBottom: 14 }}>
        <div className="cm-feature-card">
          <DatabaseOutlined style={{ fontSize: 18, color: 'var(--cm-brand-color)' }} />
          <div style={{ color: 'var(--cm-text-primary)', marginTop: 10, fontWeight: 600 }}>{td('accounts.feature_sync_title', '账号同步')}</div>
          <div style={{ color: 'var(--cm-text-secondary)', marginTop: 4 }}>{td('accounts.feature_sync_copy', '导入、刷新、导出保持同一套流程。')}</div>
        </div>
        <div className="cm-feature-card">
          <RocketOutlined style={{ fontSize: 18, color: 'var(--cm-brand-color)' }} />
          <div style={{ color: 'var(--cm-text-primary)', marginTop: 10, fontWeight: 600 }}>{td('accounts.feature_auto_reply_title', '自动回复')}</div>
          <div style={{ color: 'var(--cm-text-secondary)', marginTop: 4 }}>{td('accounts.feature_auto_reply_copy', '后续可接入会话自动化规则。')}</div>
        </div>
        <div className="cm-feature-card">
          <LinkOutlined style={{ fontSize: 18, color: 'var(--cm-brand-color)' }} />
          <div style={{ color: 'var(--cm-text-primary)', marginTop: 10, fontWeight: 600 }}>{td('accounts.feature_ai_title', 'AI 辅助')}</div>
          <div style={{ color: 'var(--cm-text-secondary)', marginTop: 4 }}>{td('accounts.feature_ai_copy', '翻译、回复建议和策略分析可按需接入。')}</div>
        </div>
        <div className="cm-feature-card">
          <ThunderboltOutlined style={{ fontSize: 18, color: 'var(--cm-brand-color)' }} />
          <div style={{ color: 'var(--cm-text-primary)', marginTop: 10, fontWeight: 600 }}>{td('accounts.feature_proxy_review_title', '代理复核')}</div>
          <div style={{ color: 'var(--cm-text-secondary)', marginTop: 4 }}>{td('accounts.feature_proxy_review_copy', '提前识别代理异常，避免任务卡死。')}</div>
        </div>
      </div>

      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        className="cm-table-shell"
        items={[
          {
            key: 'accounts',
            label: td('accounts.resource_inventory', '资源库存'),
            children: (
              <AccountsTab
                t={tWithDefault}
                searchText={searchText}
                setSearchText={setSearchText}
                accountStatusFilter={accountStatusFilter}
                setAccountStatusFilter={setAccountStatusFilter}
                setAccPagination={setAccPagination}
                handleExportTrigger={() => openModal('exportFields')}
                fetchAccounts={fetchAccounts}
                accountColumns={accountColumns}
                accounts={accounts}
                accLoading={accLoading}
                accPagination={accPagination}
                selectedKeys={selectedKeys}
                setSelectedKeys={setSelectedKeys}
                handleMouseEnter={handleMouseEnter}
                handleMouseLeave={handleMouseLeave}
                getSelectionClass={getSelectionClass}
                selectAllAcrossPages={selectAllAcrossPages}
              />
            ),
          },
          {
            key: 'sub-accounts',
            label: td('accounts.sub_account_management', '子账号管理'),
            children: (
              <SubAccountsTab
                onOpenActivate={() => openModal('activateCard')}
                fetchSubAccounts={() => fetchSubAccounts()}
                subAccounts={subAccounts}
                subLoading={subAccLoading}
                pagination={subAccPagination}
                onPaginationChange={(page, pageSize) => fetchSubAccounts(page, pageSize)}
                filters={subAccountFilters}
                onFiltersChange={setSubAccountFilters}
              />
            ),
          },
          {
            key: 'proxy-pool',
            label: td('accounts.proxy_pool', '代理池'),
            children: <ProxyPoolTab />,
          },
        ]}
      />

      <ExportFieldsModal
        open={modals.exportFields}
        onCancel={() => closeModal('exportFields')}
        onConfirm={exportWithSelectedFields}
        exportFormat={exportFormat}
        setExportFormat={setExportFormat}
        selectedExportFields={selectedExportFields}
        setSelectedExportFields={setSelectedExportFields}
        allFieldOptions={['phone', 'email', 'username', 'password', 'token', 'proxy_url', 'system_type', 'status', 'tn_client_id', 'tn_device_model', 'tn_os_version', 'tn_user_agent', 'tn_uuid', 'tn_vid', 'signature', 'app_version', 'brand', 'language', 'fp', 'tn_session_id']}
        presetFields={['phone', 'username', 'password', 'token', 'proxy_url']}
        accountsCount={(accPagination.total as number) ?? 0}
      />
        <ActivateCardModal
        open={modals.activateCard}
        onCancel={() => closeModal('activateCard')}
        onSuccess={() => {
          message.success(td('accounts.activate_card_success', '激活卡成功'));
          fetchSubAccounts();
        }}
      />
      <AccountConfigDrawer
        open={modals.accountConfig}
        selectedAccount={selectedAccount}
        onClose={async () => {
          if (selectedAccount) {
            await api.post(`/accounts/${selectedAccount.id}/unlock`);
          }
          closeModal('accountConfig');
          setSelectedAccount(null);
        }}
        onSave={() => {
          message.success(td('accounts.save_success', '保存成功'));
          closeModal('accountConfig');
          fetchAccounts();
        }}
      />
    </Content>
  );
};

export default AccountManager;
