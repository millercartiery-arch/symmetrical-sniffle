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
      message.error(t('accounts.fetch_failed') || 'Failed to fetch accounts');
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
      message.error(t('accounts.fetch_failed') || '获取子账号列表失败');
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
    const hide = message.loading(t('accounts.loading_all_ids', { defaultValue: 'Loading all IDs...' }), 0);
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
          t('accounts.selected_all_records', {
            defaultValue: 'Selected all {{count}} records',
            count: res.ids.length,
          })
        );
      }
    } catch (err) {
      message.error(t('accounts.select_all_failed', { defaultValue: 'Select all failed' }));
    } finally {
      hide();
    }
  };

  const exportWithSelectedFields = async () => {
    if (selectedExportFields.length === 0) {
      message.warning(t('accounts.select_export_field_required', { defaultValue: 'Select at least one export field' }));
      return;
    }
    let dataToExport = accounts;
    const total = (accPagination.total as number) ?? 0;
    if (total > accounts.length) {
      const hide = message.loading(t('accounts.loading_full_export_data', { defaultValue: 'Loading full data for export...' }), 0);
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
          t('accounts.export_current_page_only', {
            defaultValue: 'Unable to load the full dataset. Exporting the current page only.',
          })
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
      t('accounts.export_completed', {
        defaultValue: 'Export completed: {{filename}} ({{count}} records)',
        filename,
        count: picked.length,
      })
    );
    api.post('/audit/log', {
      action: 'EXPORT',
      details: { filename, count: picked.length, fields: selectedExportFields, format: exportFormat },
    }).catch(console.error);
  };

  const accountColumns: ColumnsType<any> = [
    { title: 'ID', dataIndex: 'id', width: 80, className: 'text-xs opacity-60' },
    { title: t('accounts.phone'), dataIndex: 'phone', render: (val: string) => <span className="font-mono">{val}</span> },
    {
      title: t('accounts.sent_daily_max', { defaultValue: 'Sent/Daily Max' }),
      render: (_: any, rec: any) => (
        <span className="font-mono">{rec.today_sent || 0} / {rec.daily_limit || 25}</span>
      ),
    },
    {
      title: t('accounts.total_sent_recv', { defaultValue: 'Total Sent/Recv' }),
      render: (_: any, rec: any) => (
        <span className="font-mono">{rec.sent_count || 0} / {rec.received_count || 0}</span>
      ),
    },
    {
      title: t('accounts.cooldown_status', { defaultValue: 'Cooldown Status' }),
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
                {t('accounts.cooldown_remaining', {
                  defaultValue: '{{h}}h {{m}}m {{s}}s remaining',
                  h,
                  m,
                  s,
                })}
              </span>
            );
          }
        }
        return <StatusTag type="account" status={status} />;
      },
    },
    { title: t('accounts.tn_ready') || 'TN Protocol', dataIndex: 'tn_ready', render: (val: number) => <StatusTag type="number" status={val ? 'Ready' : 'Dead'} /> },
    { title: t('accounts.updated_at'), dataIndex: 'updated_at', render: (val: string) => new Date(val).toLocaleString() },
    {
      title: t('common.action'),
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
                  t('accounts.locked_by_other_user', {
                    defaultValue: 'This account is currently being edited by {{user}} (TC-17)',
                    user: err.response.data.user,
                  })
                );
              } else {
                message.error(t('accounts.lock_failed_generic', { defaultValue: 'Unable to lock account' }));
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
          title: 'Protocol routing is not ready',
          copy: 'No active TN-ready inventory is visible on the current slice. Validate imported accounts and proxy bindings before opening new outbound volume.',
          action: 'Review proxy pool',
          onClick: () => setActiveTab('proxy-pool'),
        }
      : inventoryStats.cooldown > inventoryStats.ready
        ? {
            title: 'Recovery should come before scale',
            copy: 'Cooldown inventory is larger than the ready pool. Operators should clear unstable accounts before pushing more conversations into queue.',
            action: 'Review account inventory',
            onClick: () => setActiveTab('accounts'),
          }
        : {
            title: 'Inventory is usable for controlled execution',
            copy: 'Ready accounts and TN protocol coverage are visible. This is the right time to refresh assets, export clean slices and move only validated inventory into live routing.',
            action: 'Export clean inventory',
            onClick: () => openModal('exportFields'),
          };

  return (
    <Content className="cm-page" style={{ padding: 20 }}>
      <div className="cm-page-header">
        <div>
          <div className="cm-kpi-eyebrow">Resource Management</div>
          <h1 className="cm-page-title cm-brand-title" style={{ fontSize: 32 }}>
            Inventory & Routing
          </h1>
          <div className="cm-page-subtitle">
            Resource inventory, sub-account activation and proxy orchestration now share one operational surface with faster scanning and clearer anomaly emphasis.
          </div>
        </div>
      </div>

      <div className="cm-hero-band">
        <div className="cm-hero-panel">
          <div className="cm-kpi-eyebrow">Inventory Command</div>
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
            <Button onClick={() => setActiveTab('accounts')}>Inspect inventory</Button>
            <Button onClick={() => setActiveTab('sub-accounts')}>Open sub-accounts</Button>
          </div>
          <div className="cm-hero-metrics">
            <div className="cm-mini-stat">
              <div className="cm-kpi-eyebrow">Visible Inventory</div>
              <strong>{inventoryStats.total}</strong>
              <span>Accounts inside the current operational window</span>
            </div>
            <div className="cm-mini-stat">
              <div className="cm-kpi-eyebrow">Ready Pool</div>
              <strong>{inventoryStats.ready}</strong>
              <span>Accounts currently available for controlled work</span>
            </div>
            <div className="cm-mini-stat">
              <div className="cm-kpi-eyebrow">Cooldown Pressure</div>
              <strong>{inventoryStats.cooldown}</strong>
              <span>Inventory temporarily blocked by cooldown or recovery</span>
            </div>
            <div className="cm-mini-stat">
              <div className="cm-kpi-eyebrow">TN Protocol Ready</div>
              <strong>{inventoryStats.tnReady}</strong>
              <span>Assets with protocol-level readiness on the current slice</span>
            </div>
          </div>
        </div>

        <div className="cm-hero-panel">
          <div className="cm-kpi-eyebrow">Operator Guidance</div>
          <div className="cm-signal-list" style={{ marginTop: 16 }}>
            <div className="cm-signal-item">
              <div>
                <strong>Refresh before taking action</strong>
                <span>Always reload inventory before exporting, binding proxies or activating sub-accounts.</span>
              </div>
              <Button size="small" onClick={fetchAccounts}>Refresh</Button>
            </div>
            <div className="cm-signal-item">
              <div>
                <strong>Separate clean inventory from unstable assets</strong>
                <span>Use status filters to isolate ready inventory from cooldown and dead accounts before batch actions.</span>
              </div>
              <Button size="small" onClick={() => setAccountStatusFilter('Ready')}>Show ready</Button>
            </div>
            <div className="cm-signal-item">
              <div>
                <strong>Move routing work into the proxy surface</strong>
                <span>Proxy health determines delivery consistency. Treat it as a primary operating area, not a secondary settings page.</span>
              </div>
              <Button size="small" onClick={() => setActiveTab('proxy-pool')}>Open proxy pool</Button>
            </div>
          </div>
        </div>
      </div>

      <div className="cm-feature-grid" style={{ marginBottom: 20 }}>
        <div className="cm-feature-card">
          <DatabaseOutlined style={{ fontSize: 18, color: '#f3d5d5' }} />
          <div style={{ color: '#f5e9e5', marginTop: 10, fontWeight: 600 }}>Sync TextNow Accounts</div>
          <div style={{ color: '#b9a19a', marginTop: 4 }}>Refresh inventory and inspect routeable assets.</div>
        </div>
        <div className="cm-feature-card">
          <RocketOutlined style={{ fontSize: 18, color: '#f3d5d5' }} />
          <div style={{ color: '#f5e9e5', marginTop: 10, fontWeight: 600 }}>Setup Auto Reply</div>
          <div style={{ color: '#b9a19a', marginTop: 4 }}>Pair accounts with templates and execution rules.</div>
        </div>
        <div className="cm-feature-card">
          <LinkOutlined style={{ fontSize: 18, color: '#f3d5d5' }} />
          <div style={{ color: '#f5e9e5', marginTop: 10, fontWeight: 600 }}>Configure AI Engine</div>
          <div style={{ color: '#b9a19a', marginTop: 4 }}>Connect translation and behavior services for automation.</div>
        </div>
        <div className="cm-feature-card">
          <ThunderboltOutlined style={{ fontSize: 18, color: '#f3d5d5' }} />
          <div style={{ color: '#f5e9e5', marginTop: 10, fontWeight: 600 }}>Proxy Health Review</div>
          <div style={{ color: '#b9a19a', marginTop: 4 }}>Surface latency spikes before delivery drops start.</div>
        </div>
      </div>

      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        className="cm-table-shell"
        items={[
          {
            key: 'accounts',
            label: t('accounts.resource_inventory'),
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
            label: t('accounts.sub_account_management'),
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
            label: t('accounts.proxy_pool'),
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
          message.success('卡密激活成功，已创建子账号');
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
          message.success('保存成功');
          closeModal('accountConfig');
          fetchAccounts();
        }}
      />
    </Content>
  );
};

export default AccountManager;
