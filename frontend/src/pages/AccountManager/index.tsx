import React, { useState, useEffect, useMemo } from 'react';
import { Layout, Tabs, message, Button } from 'antd';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import { EditOutlined } from '@ant-design/icons';
import api from '../../api';
import AccountsTab from './components/AccountsTab';
import SubAccountsTab from './components/SubAccountsTab';
import ActivateCardModal from './components/ActivateCardModal';
import AccountConfigDrawer from './components/AccountConfigDrawer';
import ProxyPoolTab from './components/ProxyPoolTab';
import { useSelectionStyle } from '../../hooks/useSelectionStyle';
import StatusTag from '../../components/Common/StatusTag';
import { getSocket } from '../../utils/socket';
import { getUserRole } from '../../utils/jwt-auth';
import {
  canManageSubaccounts,
} from '../../utils/access-control';
import type { PaginationProps } from 'antd';
import type { ColumnsType } from 'antd/es/table';

const { Content } = Layout;

const AccountManager: React.FC = () => {
  const { t } = useTranslation();
  const userRole = getUserRole();
  const canManageAgents = canManageSubaccounts(userRole);
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
    activateCard: false,
    accountConfig: false,
  });
  const [selectedAccount, setSelectedAccount] = useState<any>(null);

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
  const inventorySummary = [
    {
      key: 'total',
      label: td('accounts.visible_inventory', '当前可见库存'),
      value: inventoryStats.total,
      meta: td('accounts.visible_inventory_meta', '正在展示的账号总数'),
      tone: 'cooldown',
    },
    {
      key: 'ready',
      label: td('accounts.ready_pool', 'Ready 池'),
      value: inventoryStats.ready,
      meta: td('accounts.ready_pool_meta', '可直接调度的账号'),
      tone: 'ready',
    },
    {
      key: 'protocol',
      label: td('accounts.tn_protocol_ready', 'TN 协议就绪'),
      value: inventoryStats.tnReady,
      meta: td('accounts.tn_protocol_ready_meta', '可进入发送调度的账号'),
      tone: inventoryStats.tnReady > 0 ? 'ready' : 'dead',
    },
  ];

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
            copy: td('accounts.focus.healthy_copy_no_export', '当前可用库存正常，继续查看子账号分发与协议配置。'),
            action: td('accounts.focus.open_sub_accounts', '查看子账号'),
            onClick: () => setActiveTab('sub-accounts'),
          };

  return (
    <Content className="cm-page" style={{ padding: 16 }}>
      <div className="cm-page-header cm-page-header--dashboard">
        <div>
          <div className="cm-kpi-eyebrow">{td('accounts.page_eyebrow', '资源管理')}</div>
          <h1 className="cm-page-title cm-brand-title" style={{ fontSize: 32 }}>
            {td('accounts.page_title', '资源与路由控制台')}
          </h1>
          <div className="cm-page-subtitle">
            {td('accounts.page_subtitle', '先看库存，再进子账号和代理池。')}
          </div>
        </div>
      </div>

      <div className="cm-summary-strip">
        <div className="cm-summary-focus">
          <div className="cm-summary-focus__head">
            <div className="cm-kpi-eyebrow">{td('accounts.inventory_command', '库存指令')}</div>
          </div>
          <h2 className="cm-page-title" style={{ fontSize: 28, marginTop: 8 }}>
            {inventoryFocus.title}
          </h2>
          <div className="cm-summary-focus__copy">
            {inventoryFocus.copy}
          </div>
          <div className="cm-priority-actions">
            <Button type="primary" className="cm-primary-button" onClick={inventoryFocus.onClick}>
              {inventoryFocus.action}
            </Button>
            <Button onClick={() => setActiveTab('accounts')}>{td('accounts.inspect_inventory', '查看库存')}</Button>
            {canManageAgents && (
              <Button onClick={() => setActiveTab('sub-accounts')}>{td('accounts.open_sub_accounts', '打开子账号')}</Button>
            )}
            <Button onClick={fetchAccounts}>{td('common.refresh', '刷新')}</Button>
          </div>
        </div>

        <div className="cm-summary-metrics">
          {inventorySummary.map((item) => (
            <div key={item.key} className={`cm-summary-metric cm-summary-metric--${item.tone}`}>
              <span className="cm-summary-metric__label">{item.label}</span>
              <strong className="cm-summary-metric__value">{item.value}</strong>
              <span className="cm-summary-metric__meta">{item.meta}</span>
            </div>
          ))}
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
          ...(canManageAgents
            ? [{
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
              }]
            : []),
          ...(canManageAgents
            ? [{
                key: 'proxy-pool',
                label: td('accounts.proxy_pool', '代理池'),
                children: <ProxyPoolTab />,
              }]
            : []),
        ]}
      />

      {canManageAgents && (
        <ActivateCardModal
          open={modals.activateCard}
          onCancel={() => closeModal('activateCard')}
          onSuccess={() => {
            message.success(td('accounts.activate_card_success', '激活卡成功'));
            fetchSubAccounts();
          }}
        />
      )}
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
