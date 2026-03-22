/* ====================== AccountsTab.tsx ====================== */
import React, {
  useMemo,
  useCallback,
  ChangeEvent,
  memo,
  FC,
  ReactNode,
} from 'react';
import {
  Input,
  Select,
  Button,
  Table,
  Alert,
  PaginationProps,
  TableProps,
  RowSelection,
} from 'antd';
import {
  SearchOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import type { FilterValue } from 'antd/es/table/interface';

/* ---------- 1️⃣ 业务数据模型 ---------- */
export interface AccountRecord {
  id: string | number;
  // 其它业务字段随意扩展
  [key: string]: any;
}

/* ---------- 2️⃣ 组件 Props（泛型） ---------- */
export interface AccountsTabProps<T extends AccountRecord> {
  /** i18n 翻译函数，推荐使用 i18next 的 t */
  t: (key: string, opts?: { defaultValue?: string }) => string;

  /** 搜索框内容 */
  searchText: string;
  setSearchText: (v: string) => void;

  /** 账户状态过滤值（受控） */
  accountStatusFilter: string;
  setAccountStatusFilter: (v: string) => void;

  /** 分页状态 */
  setAccPagination: React.Dispatch<React.SetStateAction<PaginationProps>>;

  /** 刷新回调 */
  fetchAccounts: () => void;

  /** 表格列定义（AntD ColumnsType） */
  accountColumns: ColumnsType<T>;

  /** 表格数据 */
  accounts: T[];

  /** 加载状态 */
  accLoading: boolean;

  /** 分页属性（AntD PaginationProps） */
  accPagination: PaginationProps;

  /** 已选中的行 key（使用 AntD RowKey 类型） */
  selectedKeys: React.Key[];
  setSelectedKeys: (keys: React.Key[]) => void;

  /** 鼠标悬停高亮相关 */
  handleMouseEnter: (key: React.Key) => void;
  handleMouseLeave: () => void;
  /** 根据 record 返回行 className（用于自定义高亮） */
  getSelectionClass: (record: T) => string;

  /** 「全选跨页」回调 */
  selectAllAcrossPages: () => void;
}

/* ---------- 3️⃣ 子组件：工具栏 ---------- */
const AccountsToolbar = memo(
  ({
    t,
    searchText,
    setSearchText,
    accountStatusFilter,
    setAccountStatusFilter,
    setAccPagination,
    fetchAccounts,
  }: Pick<
    AccountsTabProps<AccountRecord>,
    | 't'
    | 'searchText'
    | 'setSearchText'
    | 'accountStatusFilter'
    | 'setAccountStatusFilter'
    | 'setAccPagination'
    | 'fetchAccounts'
  >) => {
    const selectOptions = useMemo(
      () => [
        {
          value: 'all',
          label: t('accounts.all_status', { defaultValue: 'All Status' }),
        },
        { value: 'Ready', label: 'Ready' },
        { value: 'Cooldown', label: 'Cooldown' },
        { value: 'Dead', label: 'Dead' },
        { value: 'Busy', label: 'Busy' },
      ],
      [t],
    );

    const onStatusChange = useCallback(
      (value: string) => {
        setAccountStatusFilter(value);
        // 切换筛选时回到第 1 页
        setAccPagination((prev) => ({
          ...prev,
          current: 1,
        }));
      },
      [setAccountStatusFilter, setAccPagination],
    );

    const onSearchChange = useCallback(
      (e: ChangeEvent<HTMLInputElement>) => setSearchText(e.target.value),
      [setSearchText],
    );

    return (
      <div className="cm-toolbar-shell">
        <div className="cm-toolbar-group">
          <Input
            placeholder={t('accounts.search_id', {
              defaultValue: 'Search by ID',
            })}
            prefix={<SearchOutlined />}
            value={searchText}
            onChange={onSearchChange}
            aria-label={t('accounts.search_id', {
              defaultValue: 'Search by ID',
            })}
            style={{ width: 240 }}
          />
          <Select
            value={accountStatusFilter}
            style={{ width: 150 }}
            options={selectOptions}
            onChange={onStatusChange}
            aria-label={t('accounts.filter_status', {
              defaultValue: 'Filter by status',
            })}
          />
        </div>

        <div className="cm-toolbar-group cm-toolbar-group--actions">
          <Button
            type="primary"
            icon={<ReloadOutlined />}
            onClick={fetchAccounts}
            className="cm-primary-button"
          >
            {t('accounts.refresh', { defaultValue: 'Refresh' })}
          </Button>
        </div>
      </div>
    );
  },
);

/* ---------- 4️⃣ 子组件：已选提示 ---------- */
interface SelectionAlertProps {
  t: (key: string, opts?: { defaultValue?: string }) => string;
  selectedCount: number;
  total: number;
  onClear: () => void;
  onSelectAll: () => void;
}
const SelectionAlert = memo(
  ({
    t,
    selectedCount,
    total,
    onClear,
    onSelectAll,
  }: SelectionAlertProps) => {
    return (
      <Alert
        type="info"
        showIcon
        role="status"
        style={{ marginBottom: 16 }}
        message={
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span>
              {t('accounts.selected', {
                defaultValue: `已选中 ${selectedCount} 项`,
              })}
              {selectedCount < total && (
                <Button
                  type="link"
                  size="small"
                  onClick={onSelectAll}
                  style={{ marginLeft: 8 }}
                >
                  {t('accounts.select_all', {
                    defaultValue: `选中全部 ${total} 条数据`,
                  })}
                </Button>
              )}
            </span>
            <Button type="link" size="small" onClick={onClear}>
              {t('common.clear', { defaultValue: '清空选择' })}
            </Button>
          </div>
        }
      />
    );
  },
);

/* ---------- 5️⃣ 主组件 ---------- */
function AccountsTab<T extends AccountRecord>(props: AccountsTabProps<T>) {
  const {
    t,
    searchText,
    setSearchText,
    accountStatusFilter,
    setAccountStatusFilter,
    setAccPagination,
    fetchAccounts,
    accountColumns,
    accounts,
    accLoading,
    accPagination,
    selectedKeys,
    setSelectedKeys,
    handleMouseEnter,
    handleMouseLeave,
    getSelectionClass,
    selectAllAcrossPages,
  } = props;

  /* ---------- rowSelection（memo） ---------- */
  const rowSelection: RowSelection<T> = useMemo(
    () => ({
      selectedRowKeys: selectedKeys,
      onChange: (keys) => setSelectedKeys(keys as React.Key[]),
      // 如需跨页保留选择，可在这里加 `preserveSelectedRowKeys: true`
    }),
    [selectedKeys, setSelectedKeys],
  );

  /* ---------- onRow（memo） ---------- */
  const onRow = useCallback(
    (record: T) => ({
      onMouseEnter: () => handleMouseEnter(record.id),
      onMouseLeave: handleMouseLeave,
    }),
    [handleMouseEnter, handleMouseLeave],
  );

  /* ---------- 表格分页回调 ---------- */
  const onTableChange = useCallback(
    (pagination: any) => {
      setAccPagination((prev: any) => ({
        ...prev,
        current: pagination.current ?? 1,
        pageSize: pagination.pageSize ?? prev.pageSize,
      }));
    },
    [setAccPagination],
  );

  /* ---------- 表格列（若父组件不需要动态变化，可直接使用 props） ---------- */
  const columns = useMemo(() => accountColumns, [accountColumns]);

  return (
    <>
      {/* ① Toolbar */}
      <AccountsToolbar
        t={t}
        searchText={searchText}
        setSearchText={setSearchText}
        accountStatusFilter={accountStatusFilter}
        setAccountStatusFilter={setAccountStatusFilter}
        setAccPagination={setAccPagination}
        fetchAccounts={fetchAccounts}
      />

      {/* ② 已选提示（仅在有选中时渲染） */}
      {selectedKeys.length > 0 && (
        <SelectionAlert
          t={t}
          selectedCount={selectedKeys.length}
          total={(accPagination as any)?.total ?? 0}
          onClear={() => setSelectedKeys([])}
          onSelectAll={selectAllAcrossPages}
        />
      )}

      {/* ③ 主表格 */}
      <Table<T>
        className="cm-table-shell"
        columns={columns}
        dataSource={accounts}
        rowKey={(record) => record.id}
        loading={accLoading}
        pagination={accPagination}
        onChange={onTableChange}
        rowSelection={rowSelection}
        onRow={onRow}
        rowClassName={(record) => getSelectionClass(record)}
        scroll={{ x: 'max-content' }}
        locale={{
          emptyText: t('common.no_data', { defaultValue: '暂无数据' }),
        }}
      />
    </>
  );
}

/* ---------- 6️⃣ 导出 memo 包装的组件 ---------- */
export default memo(AccountsTab) as typeof AccountsTab;
