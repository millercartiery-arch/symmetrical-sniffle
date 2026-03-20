import React, { useEffect, useState } from 'react';
import { Button, Form, Input, InputNumber, message, Modal, Popconfirm, Select, Space, Switch, Table, Tag } from 'antd';
import { EditOutlined, KeyOutlined, ReloadOutlined, DeleteOutlined } from '@ant-design/icons';
import api from '../../../api';
import StatusTag from '../../../components/Common/StatusTag';

export type SubAccountRow = {
  id: number;
  card_key_id: number | null;
  credential_id: number;
  credential_type: string;
  credential_username: string;
  card_type: string;
  card_status: string;
  card_use_count: number;
  card_max_use: number | null;
  region: string | null;
  weight: number;
  proxy_id: number | null;
  status: string;
  is_busy: number;
  enabled: number;
  tenant_id: number;
  created_at: string;
  updated_at: string;
};

type Props = {
  onOpenActivate: () => void;
  fetchSubAccounts: () => void;
  subAccounts: SubAccountRow[];
  subLoading: boolean;
  pagination: { current: number; pageSize: number; total: number };
  onPaginationChange: (page: number, pageSize: number) => void;
  filters: { status?: string; region?: string; proxy_id?: string };
  onFiltersChange: (f: { status?: string; region?: string; proxy_id?: string }) => void;
};

const SubAccountsTab: React.FC<Props> = ({
  onOpenActivate,
  fetchSubAccounts,
  subAccounts,
  subLoading,
  pagination,
  onPaginationChange,
  filters,
  onFiltersChange,
}) => {
  const [proxyList, setProxyList] = useState<{ id: number; host: string; port: number; description?: string }[]>([]);
  const [form] = Form.useForm();
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<SubAccountRow | null>(null);
  const [editForm, setEditForm] = useState<{ status: string; weight: number; proxy_id: number | null; region: string; enabled: boolean }>({
    status: 'ready',
    weight: 1,
    proxy_id: null,
    region: '',
    enabled: true,
  });
  const [saveLoading, setSaveLoading] = useState(false);

  useEffect(() => {
    api.get('/proxies', { params: { page: 1, pageSize: 200 } }).then((res: any) => {
      // 后端返回：{ code: 0, data: rows, list: rows, ... }
      const list = res?.data ?? res?.list ?? [];
      setProxyList(Array.isArray(list) ? list : []);
    }).catch(() => {});
  }, []);

  const openEdit = (record: SubAccountRow) => {
    setEditingRow(record);
    const nextForm = {
      status: record.status || 'ready',
      weight: record.weight ?? 1,
      proxy_id: record.proxy_id ?? null,
      region: record.region ?? '',
      enabled: record.enabled !== 0,
    };
    setEditForm(nextForm);
    form.setFieldsValue(nextForm);
    setEditModalOpen(true);
  };

  const saveEdit = async () => {
    if (!editingRow) return;
    const values = await form.validateFields().catch(() => null);
    if (!values) return;
    setSaveLoading(true);
    try {
      const payload = {
        status: values.status,
        weight: Number(values.weight) || 1,
        proxy_id: values.proxy_id ?? null,
        region: values.region || undefined,
        enabled: Boolean(values.enabled),
      };
      await api.patch(`/sub-accounts/${editingRow.id}`, {
        ...payload,
      });
      setEditForm(payload);
      message.success('已更新');
      setEditModalOpen(false);
      setEditingRow(null);
      form.resetFields();
      fetchSubAccounts();
    } catch (e: any) {
      message.error(e?.response?.data?.error ?? '更新失败');
    } finally {
      setSaveLoading(false);
    }
  };

  const deleteSubAccount = async (id: number) => {
    try {
      await api.delete(`/sub-accounts/${id}`);
      message.success('已删除');
      fetchSubAccounts();
    } catch (e: any) {
      message.error(e?.response?.data?.error ?? '删除失败');
    }
  };

  const closeEditModal = () => {
    setEditModalOpen(false);
    setEditingRow(null);
    form.resetFields();
  };

  const columns = [
    { title: 'ID', dataIndex: 'id', width: 72, render: (v: number) => <span className="font-mono">{v}</span> },
    { title: '凭证账号', dataIndex: 'credential_username', width: 120, ellipsis: true },
    { title: '凭证类型', dataIndex: 'credential_type', width: 90 },
    { title: '卡密类型', dataIndex: 'card_type', width: 90 },
    {
      title: '卡密状态',
      key: 'card_status',
      width: 90,
      render: (_: any, r: SubAccountRow) => (
        <span>
          <Tag color={r.card_status === 'active' ? 'green' : r.card_status === 'used' ? 'default' : 'orange'}>{r.card_status}</Tag>
          {r.card_max_use != null && <span className="text-xs opacity-70"> {r.card_use_count}/{r.card_max_use}</span>}
        </span>
      ),
    },
    { title: '地区', dataIndex: 'region', width: 90, render: (v: string) => v || '—' },
    { title: '权重', dataIndex: 'weight', width: 72 },
    {
      title: '代理',
      dataIndex: 'proxy_id',
      width: 100,
      render: (id: number | null) => {
        if (id == null) return '—';
        const p = proxyList.find((x) => x.id === id);
        return p ? `${p.host}:${p.port}` : `#${id}`;
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 88,
      render: (status: string, r: SubAccountRow) => (
        <Space size={4}>
          <StatusTag type="account" status={status} />
          {r.is_busy ? <Tag color="orange">忙</Tag> : null}
        </Space>
      ),
    },
    {
      title: '启用',
      dataIndex: 'enabled',
      width: 64,
      render: (v: number) => (v ? <Tag color="green">是</Tag> : <Tag>否</Tag>),
    },
    { title: '创建时间', dataIndex: 'created_at', width: 160, render: (v: string) => (v ? new Date(v).toLocaleString() : '—') },
    {
      title: '操作',
      key: 'action',
      width: 140,
      fixed: 'right' as const,
      render: (_: any, record: SubAccountRow) => (
        <Space size="small">
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEdit(record)}>
            编辑
          </Button>
          <Popconfirm
            title="确定删除该子账号？删除后调度将不再选中。"
            onConfirm={() => deleteSubAccount(record.id)}
          >
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <>
      <div style={{ marginBottom: 16, display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
        <Space wrap>
          <Button type="primary" icon={<KeyOutlined />} onClick={onOpenActivate}>
            卡密激活
          </Button>
          <Button icon={<ReloadOutlined />} onClick={fetchSubAccounts}>刷新</Button>
        </Space>
        <Space wrap>
          <Select
            placeholder="状态"
            allowClear
            style={{ width: 100 }}
            value={filters.status || undefined}
            onChange={(v) => onFiltersChange({ ...filters, status: v ?? undefined })}
            options={[
              { label: '全部', value: '' },
              { label: 'ready', value: 'ready' },
              { label: 'busy', value: 'busy' },
              { label: 'cooldown', value: 'cooldown' },
            ]}
          />
          <Input
            placeholder="地区"
            style={{ width: 100 }}
            value={filters.region ?? ''}
            onChange={(e) => onFiltersChange({ ...filters, region: e.target.value || undefined })}
            allowClear
          />
          <Select
            placeholder="代理"
            allowClear
            style={{ width: 160 }}
            value={filters.proxy_id || undefined}
            onChange={(v) => onFiltersChange({ ...filters, proxy_id: v ?? undefined })}
            options={[
              { label: '全部', value: '' },
              ...proxyList.map((p) => ({ label: p.description ? `${p.description} (${p.host}:${p.port})` : `${p.host}:${p.port}`, value: String(p.id) })),
            ]}
          />
        </Space>
      </div>

      <Table
        rowKey="id"
        size="small"
        columns={columns}
        dataSource={subAccounts}
        loading={subLoading}
        scroll={{ x: 1200 }}
        pagination={{
          current: pagination.current,
          pageSize: pagination.pageSize,
          total: pagination.total,
          showSizeChanger: true,
          showTotal: (t) => `共 ${t} 条`,
          onChange: onPaginationChange,
        }}
      />

      <Modal
        title={editingRow ? `编辑子账号 #${editingRow.id}` : '编辑子账号'}
        open={editModalOpen}
        onCancel={closeEditModal}
        onOk={saveEdit}
        confirmLoading={saveLoading}
        destroyOnClose
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={editForm}
          onValuesChange={(_, values) => setEditForm(values)}
        >
          <Form.Item
            name="status"
            label="状态"
            rules={[{ required: true, message: '请选择状态' }]}
          >
            <Select
              options={[
                { label: 'ready', value: 'ready' },
                { label: 'busy', value: 'busy' },
                { label: 'cooldown', value: 'cooldown' },
              ]}
            />
          </Form.Item>
          <Form.Item
            name="weight"
            label="权重 (1-100)"
            rules={[{ required: true, message: '请输入权重' }]}
          >
            <InputNumber min={1} max={100} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="region" label="地区">
            <Input placeholder="可选" />
          </Form.Item>
          <Form.Item name="proxy_id" label="代理">
            <Select
              allowClear
              placeholder="不绑定"
              options={proxyList.map((p) => ({
                label: p.description ? `${p.description} (${p.host}:${p.port})` : `${p.host}:${p.port}`,
                value: p.id,
              }))}
            />
          </Form.Item>
          <Form.Item name="enabled" label="启用" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
};

export default SubAccountsTab;
