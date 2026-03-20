import React, { useEffect, useState } from 'react';
import { Form, Input, InputNumber, Modal, Select } from 'antd';
import api from '../../../api';

type Props = {
  open: boolean;
  onCancel: () => void;
  onSuccess: () => void;
};

const ActivateCardModal: React.FC<Props> = ({ open, onCancel, onSuccess }) => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [proxyList, setProxyList] = useState<{ id: number; host: string; port: number; description?: string }[]>([]);

  useEffect(() => {
    if (open) {
      form.resetFields();
      api.get('/proxies', { params: { page: 1, pageSize: 200 } })
        .then((res: any) => {
          const list = res?.data?.data ?? res?.data?.list ?? res?.data ?? [];
          setProxyList(Array.isArray(list) ? list : []);
        })
        .catch(() => {});
    }
  }, [open, form]);

  const onFinish = async (values: { code: string; region?: string; weight?: number; proxy_id?: number }) => {
    setLoading(true);
    try {
      const res: any = await api.post('/card/activate', {
        code: values.code?.trim(),
        region: values.region || undefined,
        weight: Math.min(100, Math.max(1, Number(values.weight) || 1)),
        proxy_id: values.proxy_id ?? undefined,
      });
      const data = res?.data;
      if (data?.sub_account_id) {
        form.resetFields();
        onSuccess();
        onCancel();
      }
    } catch (e: any) {
      const msg = e?.response?.data?.error ?? e?.message ?? '激活失败';
      form.setFields([{ name: 'code', errors: [msg] }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title="卡密激活"
      open={open}
      onCancel={onCancel}
      onOk={() => form.submit()}
      confirmLoading={loading}
      destroyOnClose
      width={400}
    >
      <Form form={form} layout="vertical" onFinish={onFinish} initialValues={{ weight: 1 }}>
        <Form.Item name="code" label="卡密" rules={[{ required: true, message: '请输入卡密' }]}>
          <Input.Password placeholder="请输入卡密" autoComplete="off" />
        </Form.Item>
        <Form.Item name="region" label="地区">
          <Input placeholder="可选，如 shanghai" />
        </Form.Item>
        <Form.Item name="weight" label="权重" rules={[{ required: true }]}>
          <InputNumber min={1} max={100} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="proxy_id" label="绑定代理">
          <Select
            allowClear
            placeholder="可选，不绑定则稍后在列表中编辑"
            options={proxyList.map((p) => ({
              label: p.description ? `${p.description} (${p.host}:${p.port})` : `${p.host}:${p.port}`,
              value: p.id,
            }))}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default ActivateCardModal;
