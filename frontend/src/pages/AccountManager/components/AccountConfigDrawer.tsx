import React, { useEffect, useState } from 'react';
import { Avatar, Button, Descriptions, Divider, Drawer, Input, List, message, Select, Space, Switch, Typography, theme } from 'antd';
import {
  CodeOutlined,
  FileTextOutlined,
  GlobalOutlined,
  MessageOutlined,
  MobileOutlined,
  PictureOutlined,
  StopOutlined,
  SwapOutlined,
} from '@ant-design/icons';
import StatusTag from '../../../components/Common/StatusTag';
import api from '../../../api';

const { Text, Title } = Typography;
const { useToken } = theme;

type ProxyOption = { id: number; host: string; port: number; protocol?: string; description?: string; is_active?: number };
type BindingRow = { account_id: number; proxy_id: number; protocol: string; host: string; port: number };

type Props = {
  open: boolean;
  selectedAccount: any;
  onClose: () => void;
  onSave: () => void;
};

const AccountConfigDrawer: React.FC<Props> = ({ open, selectedAccount, onClose, onSave }) => {
  const { token } = useToken();
  const [proxyList, setProxyList] = useState<ProxyOption[]>([]);
  const [bindings, setBindings] = useState<BindingRow[]>([]);
  const [selectedProxyId, setSelectedProxyId] = useState<number | null>(null);
  const [bindLoading, setBindLoading] = useState(false);

  useEffect(() => {
    if (!open || !selectedAccount?.id) return;
    const load = async () => {
      try {
        const [proxRes, bindRes]: any[] = await Promise.all([
          api.get('/proxies', { params: { page: 1, pageSize: 200 } }),
          api.get('/proxies/bindings'),
        ]);
        const list = proxRes?.data?.data ?? proxRes?.data?.list ?? proxRes?.data ?? [];
        setProxyList(Array.isArray(list) ? list : []);
        const raw = bindRes?.data?.data ?? bindRes?.data ?? [];
        setBindings(Array.isArray(raw) ? raw : []);
        const current = (Array.isArray(raw) ? raw : []).find(
          (b: BindingRow) => Number(b.account_id) === Number(selectedAccount.id)
        );
        setSelectedProxyId(current ? Number(current.proxy_id) : null);
      } catch {
        setProxyList([]);
        setBindings([]);
        setSelectedProxyId(null);
      }
    };
    load();
  }, [open, selectedAccount?.id]);

  const handleBindProxy = async () => {
    if (!selectedAccount?.id || !selectedProxyId) {
      message.warning('请先选择要绑定的代理');
      return;
    }
    setBindLoading(true);
    try {
      await api.post('/proxies/bind', {
        accountId: Number(selectedAccount.id),
        proxyId: selectedProxyId,
        sessionKey: 'default',
        isPrimary: true,
      });
      message.success('代理已绑定');
      onSave();
    } catch (e: any) {
      message.error(e?.response?.data?.error ?? '绑定失败');
    } finally {
      setBindLoading(false);
    }
  };

  return (
    <Drawer
      title={
        <Space>
          <Avatar style={{ backgroundColor: token.colorPrimary }}>{selectedAccount?.id?.toString().slice(-2) || 'ID'}</Avatar>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <Text strong style={{ fontSize: 16 }}>Account {selectedAccount?.phone}</Text>
            <Text type="secondary" style={{ fontSize: 12 }}>ID: {selectedAccount?.id}</Text>
          </div>
          {selectedAccount && <StatusTag status={selectedAccount.status} type="account" />}
        </Space>
      }
      placement="right"
      onClose={onClose}
      open={open}
      width={Math.min(480, window.innerWidth - 48)}
      style={{ maxWidth: '100vw' }}
      styles={{ body: { overflowY: 'auto' } }}
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" onClick={onSave}>保存更改</Button>
        </div>
      }
    >
      {selectedAccount && (
        <>
          <Title level={5}>功能开关</Title>
          <List
            itemLayout="horizontal"
            dataSource={[
              { title: '禁用账号', desc: '暂时停止该账号所有活动', icon: <StopOutlined />, active: false, danger: true, key: 'disabled' },
              { title: '自动切换', desc: '被封禁时自动切换代理/设备', icon: <SwapOutlined />, active: true, key: 'auto_switch' },
              { title: '开启翻译', desc: '自动翻译收到的消息', icon: <GlobalOutlined />, active: true, key: 'translation' },
              { title: '群发脚本', desc: '使用预设脚本进行群发', icon: <MessageOutlined />, active: true, key: 'broadcast' },
              { title: '发送图片', desc: '允许发送图片附件', icon: <PictureOutlined />, active: false, key: 'send_images' },
              { title: '发送名片', desc: '在消息中分享名片', icon: <MobileOutlined />, active: false, key: 'send_contact' },
              { title: '文字转图', desc: '将文字转为图片发送以绕过过滤', icon: <FileTextOutlined />, active: false, key: 'text_to_image' },
            ]}
            renderItem={(item: any) => (
              <List.Item>
                  <div style={{ display: 'flex', alignItems: 'center', width: '100%', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                        <Avatar
                          icon={item.icon}
                          style={{
                            backgroundColor: item.danger ? '#fff1f0' : '#f0f0f0',
                            color: item.danger ? '#ff4d4f' : '#000000e0',
                          }}
                        />
                        <div>
                            <div style={{ fontWeight: 500 }}>{item.title}</div>
                            <div style={{ fontSize: 12, color: '#475569' }}>{item.desc}</div>
                        </div>
                    </div>
                    <Switch defaultChecked={item.active} />
                  </div>
              </List.Item>
            )}
          />

          <Divider />

          <Title level={5}>IP 配置 / 更换代理</Title>
          <Space direction="vertical" style={{ width: '100%' }} size={8}>
            <Text type="secondary">当前绑定：</Text>
            {(() => {
              const current = bindings.find((b) => Number(b.account_id) === Number(selectedAccount.id));
              if (!current) return <Text>未绑定代理（调度将跳过该账号）</Text>;
              return (
                <Text>
                  {current.protocol}://{current.host}:{current.port}
                </Text>
              );
            })()}
            <Space wrap>
              <Select
                placeholder="选择代理"
                allowClear
                style={{ minWidth: 200 }}
                value={selectedProxyId ?? undefined}
                onChange={(v) => setSelectedProxyId(v ?? null)}
                options={proxyList
                  .filter((p) => p.is_active !== 0)
                  .map((p) => ({
                    label: p.description ? `${p.description} (${p.host}:${p.port})` : `${p.host}:${p.port}`,
                    value: p.id,
                  }))}
              />
              <Button type="primary" loading={bindLoading} onClick={handleBindProxy}>
                绑定
              </Button>
            </Space>
          </Space>

          <Divider />

          <Title level={5}>技术细节</Title>
          <Descriptions column={1} size="small" bordered>
            <Descriptions.Item label="系统类型">{selectedAccount.system_type || 'Unknown'}</Descriptions.Item>
            <Descriptions.Item label="最近活跃">
              {selectedAccount.last_used_at ? new Date(selectedAccount.last_used_at).toLocaleString() : 'Never'}
            </Descriptions.Item>
            <Descriptions.Item label="代理 IP">{selectedAccount.proxy_url || 'N/A'}</Descriptions.Item>
          </Descriptions>

          <div style={{ marginTop: 16 }}>
            <Space style={{ marginBottom: 8 }}>
              <CodeOutlined /> <Text strong>原始数据</Text>
            </Space>
            <Input.TextArea
              value={JSON.stringify(selectedAccount, null, 2)}
              rows={6}
              readOnly
              style={{ fontFamily: 'monospace', fontSize: 12, backgroundColor: token.colorFillAlter }}
            />
          </div>
        </>
      )}
    </Drawer>
  );
};

export default AccountConfigDrawer;
