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
      message.error(t('accounts.fetch_failed'));
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
    const hide = message.loading(t('accounts.loading_all_ids'), 0);
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
          t('accounts.selected_all_records', { count: res.ids.length })
        );
      }
    } catch (err) {
      message.error(t('accounts.select_all_failed'));
    } finally {
      hide();
    }
  };

  const exportWithSelectedFields = async () => {
    if (selectedExportFields.length === 0) {
      message.warning(t('accounts.select_export_field_required'));
      return;
    }
    let dataToExport = accounts;
    const total = (accPagination.total as number) ?? 0;
    if (total > accounts.length) {
      const hide = message.loading(t('accounts.loading_full_export_data'), 0);
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
          t('accounts.export_current_page_only')
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
      t('accounts.export_completed', { filename, count: picked.length })
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
      title: t('accounts.sent_daily_max'),
      render: (_: any, rec: any) => (
        <span className="font-mono">{rec.today_sent || 0} / {rec.daily_limit || 25}</span>
      ),
    },
    {
      title: t('accounts.total_sent_recv'),
      render: (_: any, rec: any) => (
        <span className="font-mono">{rec.sent_count || 0} / {rec.received_count || 0}</span>
      ),
    },
    {
      title: t('accounts.cooldown_status'),
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
                {t('accounts.cooldown_remaining', { h, m, s })}
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
                  t('accounts.locked_by_other_user', { user: err.response.data.user })
                );
              } else {
                message.error(t('accounts.lock_failed_generic'));
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
          title: t('accounts.focus.protocol_not_ready_title'),
          copy: t('accounts.focus.protocol_not_ready_copy'),
          action: t('accounts.focus.review_proxy_pool'),
          onClick: () => setActiveTab('proxy-pool'),
        }
      : inventoryStats.cooldown > inventoryStats.ready
        ? {
            title: t('accounts.focus.recovery_title'),
            copy: t('accounts.focus.recovery_copy'),
            action: t('accounts.focus.review_inventory'),
            onClick: () => setActiveTab('accounts'),
          }
        : {
            title: t('accounts.focus.healthy_title'),
            copy: t('accounts.focus.healthy_copy'),
            action: t('accounts.focus.export_clean_inventory'),
            onClick: () => openModal('exportFields'),
          };

  return (
    <Content className="cm-page" style={{ padding: 16 }}>
      <div className="cm-page-header">
        <div>
          <div className="cm-kpi-eyebrow">{t('accounts.page_eyebrow')}</div>
          <h1 className="cm-page-title cm-brand-title" style={{ fontSize: 32 }}>
            {t('accounts.page_title')}
          </h1>
          <div className="cm-page-subtitle">
            {t('accounts.page_subtitle')}
          </div>
        </div>
      </div>

      <div className="cm-hero-band">
        <div className="cm-hero-panel">
          <div className="cm-kpi-eyebrow">{t('accounts.inventory_command')}</div>
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
            <Button onClick={() => setActiveTab('accounts')}>{t('accounts.inspect_inventory')}</Button>
            <Button onClick={() => setActiveTab('sub-accounts')}>{t('accounts.open_sub_accounts')}</Button>
          </div>
          <div className="cm-hero-metrics">
            <div className="cm-mini-stat">
              <div className="cm-kpi-eyebrow">{t('accounts.visible_inventory')}</div>
              <strong>{inventoryStats.total}</strong>
              <span>{t('accounts.visible_inventory_meta')}</span>
            </div>
            <div className="cm-mini-stat">
              <div className="cm-kpi-eyebrow">{t('accounts.ready_pool')}</div>
              <strong>{inventoryStats.ready}</strong>
              <span>{t('accounts.ready_pool_meta')}</span>
            </div>
            <div className="cm-mini-stat">
              <div className="cm-kpi-eyebrow">{t('accounts.cooldown_pressure')}</div>
              <strong>{inventoryStats.cooldown}</strong>
              <span>{t('accounts.cooldown_pressure_meta')}</span>
            </div>
            <div className="cm-mini-stat">
              <div className="cm-kpi-eyebrow">{t('accounts.tn_protocol_ready')}</div>
              <strong>{inventoryStats.tnReady}</strong>
              <span>{t('accounts.tn_protocol_ready_meta')}</span>
            </div>
          </div>
        </div>

        <div className="cm-hero-panel">
          <div className="cm-kpi-eyebrow">{t('accounts.operator_guidance')}</div>
          <div className="cm-signal-list" style={{ marginTop: 16 }}>
            <div className="cm-signal-item">
              <div>
                <strong>{t('accounts.guidance_refresh_title')}</strong>
                <span>{t('accounts.guidance_refresh_copy')}</span>
              </div>
              <Button size="small" onClick={fetchAccounts}>{t('common.refresh')}</Button>
            </div>
            <div className="cm-signal-item">
              <div>
                <strong>{t('accounts.guidance_clean_title')}</strong>
                <span>{t('accounts.guidance_clean_copy')}</span>
              </div>
              <Button size="small" onClick={() => setAccountStatusFilter('Ready')}>{t('accounts.show_ready')}</Button>
            </div>
            <div className="cm-signal-item">
              <div>
                <strong>{t('accounts.guidance_proxy_title')}</strong>
                <span>{t('accounts.guidance_proxy_copy')}</span>
              </div>
              <Button size="small" onClick={() => setActiveTab('proxy-pool')}>{t('accounts.open_proxy_pool')}</Button>
            </div>
          </div>
        </div>
      </div>

      <div className="cm-feature-grid" style={{ marginBottom: 14 }}>
        <div className="cm-feature-card">
          <DatabaseOutlined style={{ fontSize: 18, color: 'var(--cm-brand-color)' }} />
          <div style={{ color: 'var(--cm-text-primary)', marginTop: 10, fontWeight: 600 }}>{t('accounts.feature_sync_title')}</div>
          <div style={{ color: 'var(--cm-text-secondary)', marginTop: 4 }}>{t('accounts.feature_sync_copy')}</div>
        </div>
        <div className="cm-feature-card">
          <RocketOutlined style={{ fontSize: 18, color: 'var(--cm-brand-color)' }} />
          <div style={{ color: 'var(--cm-text-primary)', marginTop: 10, fontWeight: 600 }}>{t('accounts.feature_auto_reply_title')}</div>
          <div style={{ color: 'var(--cm-text-secondary)', marginTop: 4 }}>{t('accounts.feature_auto_reply_copy')}</div>
        </div>
        <div className="cm-feature-card">
          <LinkOutlined style={{ fontSize: 18, color: 'var(--cm-brand-color)' }} />
          <div style={{ color: 'var(--cm-text-primary)', marginTop: 10, fontWeight: 600 }}>{t('accounts.feature_ai_title')}</div>
          <div style={{ color: 'var(--cm-text-secondary)', marginTop: 4 }}>{t('accounts.feature_ai_copy')}</div>
        </div>
        <div className="cm-feature-card">
          <ThunderboltOutlined style={{ fontSize: 18, color: 'var(--cm-brand-color)' }} />
          <div style={{ color: 'var(--cm-text-primary)', marginTop: 10, fontWeight: 600 }}>{t('accounts.feature_proxy_review_title')}</div>
          <div style={{ color: 'var(--cm-text-secondary)', marginTop: 4 }}>{t('accounts.feature_proxy_review_copy')}</div>
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
          message.success(t('accounts.activate_card_success'));
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
          message.success(t('accounts.save_success'));
          closeModal('accountConfig');
          fetchAccounts();
        }}
      />
    </Content>
  );
};

export default AccountManager;
