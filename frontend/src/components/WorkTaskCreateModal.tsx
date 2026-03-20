import React, { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Typography,
  Upload,
  message,
} from 'antd';
import { ThunderboltOutlined, UploadOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import api from '../api';

const { TextArea } = Input;
const { Text, Title } = Typography;

type MediaTaskType = 'text' | 'image' | 'audio' | 'video';

interface WorkTaskCreateModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const defaultFormValues = {
  title: '',
  tn_account_ids: [],
  phones: '',
  min_interval: 300,
  max_interval: 480,
  message_type: 'text',
  direction_mode: 'one_way',
  message_content: '',
  media_url: '',
};

const WorkTaskCreateModal: React.FC<WorkTaskCreateModalProps> = ({ open, onClose, onSuccess }) => {
  const { t } = useTranslation();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [tnAccounts, setTnAccounts] = useState<any[]>([]);
  const [activeMessageType, setActiveMessageType] = useState<MediaTaskType>('text');
  const [mediaUrl, setMediaUrl] = useState('');

  const watchedPhones = Form.useWatch('phones', form) || '';
  const watchedAccounts = Form.useWatch('tn_account_ids', form) || [];
  const watchedTitle = Form.useWatch('title', form) || '';
  const watchedType = Form.useWatch('message_type', form) || activeMessageType;
  const targetCount = useMemo(
    () => String(watchedPhones).split(/\r?\n/).map((line) => line.trim()).filter(Boolean).length,
    [watchedPhones]
  );

  useEffect(() => {
    if (!open) return;
    form.setFieldsValue(defaultFormValues);
    setMediaUrl('');
    setActiveMessageType('text');
    void fetchTnAccounts();
  }, [form, open]);

  const fetchTnAccounts = async () => {
    try {
      const res: any = await api.get('/accounts?limit=100');
      setTnAccounts(Array.isArray(res?.items) ? res.items : []);
    } catch (error) {
      console.error(error);
    }
  };

  const handleAutoFillName = () => {
    const now = new Date();
    const stamp = `${now.getFullYear()}${`${now.getMonth() + 1}`.padStart(2, '0')}${`${now.getDate()}`.padStart(2, '0')}_${`${now.getHours()}`.padStart(2, '0')}${`${now.getMinutes()}`.padStart(2, '0')}`;
    form.setFieldsValue({ title: `Task_${stamp}` });
  };

  const handleMediaUpload = async (file: File, type: MediaTaskType) => {
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res: any = await api.post('/upload', formData);
      if (res?.success && res?.url) {
        setMediaUrl(res.url);
        form.setFieldsValue({ media_url: res.url, message_type: type });
        setActiveMessageType(type);
        message.success(t('common.success', { defaultValue: '成功' }));
      } else {
        message.error(t('common.failed', { defaultValue: '失败' }));
      }
    } catch {
      message.error(t('common.failed', { defaultValue: '失败' }));
    }
    return false;
  };

  const handleSelectPreset = (mode: 'clear' | 'available' | 'all') => {
    if (mode === 'clear') {
      form.setFieldsValue({ tn_account_ids: [] });
      return;
    }

    const ids = tnAccounts
      .filter((item) => mode === 'all' || ['ready', 'normal', 'active', 'online'].includes(String(item.status || '').toLowerCase()))
      .map((item) => item.id);

    form.setFieldsValue({ tn_account_ids: ids });
  };

  const handleSubmit = async (values: any) => {
    const targets = String(values.phones || '').split(/\r?\n/).map((line: string) => line.trim()).filter(Boolean);
    const isText = values.message_type === 'text';

    if (!targets.length) {
      message.warning(t('tasks.phone_required', { defaultValue: '请输入至少一个目标号码' }));
      return;
    }
    if (isText && !String(values.message_content || '').trim()) {
      message.warning(t('tasks.message_required', { defaultValue: '请输入消息内容' }));
      return;
    }
    if (!isText && !String(values.media_url || '').trim()) {
      message.warning(t('tasks.media_required', { defaultValue: '请上传媒体或提供媒体链接' }));
      return;
    }

    setLoading(true);
    try {
      await api.post('/user/campaigns', {
        name: values.title,
        minInterval: values.min_interval,
        maxInterval: values.max_interval,
        tnAccountIds: values.tn_account_ids,
        targets: targets.join('\n'),
        messageType: values.message_type,
        directionMode: values.direction_mode,
        content: isText ? values.message_content : '',
        mediaUrl: isText ? null : values.media_url,
      });
      message.success(t('tasks.create_success', { defaultValue: '任务创建成功' }));
      form.resetFields();
      setMediaUrl('');
      onSuccess();
      onClose();
    } catch {
      message.error(t('tasks.create_failed', { defaultValue: '任务创建失败' }));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Drawer
      title={null}
      open={open}
      onClose={onClose}
      placement="right"
      width={640}
      styles={{ body: { padding: 20 } }}
      extra={
        <Space>
          <Button onClick={onClose}>{t('common.cancel', { defaultValue: '取消' })}</Button>
          <Button
            type="primary"
            className="cm-primary-button"
            loading={loading}
            disabled={!String(watchedTitle).trim() || watchedAccounts.length === 0 || targetCount === 0}
            onClick={() =>
              Modal.confirm({
                title: '确认创建任务',
                content: '确定要按照当前配置创建群发任务吗？',
                okText: '确认创建',
                cancelText: '取消',
                onOk: () => form.submit(),
              })
            }
          >
            确认创建
          </Button>
        </Space>
      }
    >
      <div className="cm-page-header" style={{ marginBottom: 18 }}>
        <div>
          <Text className="cm-kpi-eyebrow">Task Composer</Text>
          <Title level={3} className="cm-page-title" style={{ marginBottom: 6 }}>
            创建任务
          </Title>
          <Text className="cm-page-subtitle">
            任务名称、发送节奏、目标号码和内容类型都在同一个抽屉里完成，减少来回切换。
          </Text>
        </div>
      </div>

      <Form form={form} layout="vertical" initialValues={defaultFormValues} onFinish={handleSubmit}>
        <div className="cm-section-card" style={{ padding: 18, marginBottom: 16 }}>
          <div className="cm-kpi-eyebrow">Basic Setup</div>
          <div className="cm-form-grid" style={{ marginTop: 14 }}>
            <Form.Item name="title" label="任务名称" rules={[{ required: true }]}>
              <Input
                placeholder="输入任务名称"
                addonAfter={<ThunderboltOutlined style={{ cursor: 'pointer', color: '#b22222' }} onClick={handleAutoFillName} />}
              />
            </Form.Item>
            <Form.Item name="direction_mode" label="发送模式">
              <Select
                options={[
                  { value: 'one_way', label: '单向发送' },
                  { value: 'two_way', label: '双向交互' },
                ]}
              />
            </Form.Item>
            <Form.Item name="min_interval" label="最小间隔 (秒)">
              <InputNumber min={0} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="max_interval" label="最大间隔 (秒)">
              <InputNumber min={0} style={{ width: '100%' }} />
            </Form.Item>
          </div>
        </div>

        <div className="cm-section-card" style={{ padding: 18, marginBottom: 16 }}>
          <div className="cm-page-header" style={{ marginBottom: 12 }}>
            <div>
              <div className="cm-kpi-eyebrow">Routing Accounts</div>
              <Text style={{ color: '#b9a19a' }}>当前已选 {watchedAccounts.length} 个账号</Text>
            </div>
            <Space wrap>
              <Button size="small" onClick={() => handleSelectPreset('clear')}>清空</Button>
              <Button size="small" onClick={() => handleSelectPreset('available')}>全选可用</Button>
              <Button size="small" onClick={() => handleSelectPreset('all')}>全选</Button>
            </Space>
          </div>
          <Form.Item name="tn_account_ids" rules={[{ required: true }]}>
            <Select
              mode="multiple"
              placeholder="选择发送账号"
              maxTagCount="responsive"
              options={tnAccounts.map((item) => ({
                value: item.id,
                label: `${item.phone || item.id} (${item.status || 'unknown'})`,
              }))}
            />
          </Form.Item>
        </div>

        <div className="cm-section-card" style={{ padding: 18, marginBottom: 16 }}>
          <div className="cm-page-header" style={{ marginBottom: 12 }}>
            <div>
              <div className="cm-kpi-eyebrow">Targets</div>
              <Text style={{ color: '#b9a19a' }}>当前识别 {targetCount} 个目标号码</Text>
            </div>
          </div>
          <Form.Item name="phones" rules={[{ required: true }]}>
            <TextArea autoSize={{ minRows: 5, maxRows: 12 }} placeholder="每行一个手机号" />
          </Form.Item>
        </div>

        <div className="cm-section-card" style={{ padding: 18 }}>
          <div className="cm-page-header" style={{ marginBottom: 12 }}>
            <div>
              <div className="cm-kpi-eyebrow">Message Payload</div>
              <Text style={{ color: '#b9a19a' }}>文本和媒体走同一套清晰配置，不再堆在一起。</Text>
            </div>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
            {[
              { value: 'text', label: '文本' },
              { value: 'image', label: '图片' },
              { value: 'audio', label: '音频' },
              { value: 'video', label: '视频' },
            ].map((item) => (
              <Button
                key={item.value}
                type={watchedType === item.value ? 'primary' : 'default'}
                className={watchedType === item.value ? 'cm-primary-button' : undefined}
                onClick={() => {
                  form.setFieldsValue({ message_type: item.value });
                  setActiveMessageType(item.value as MediaTaskType);
                }}
              >
                {item.label}
              </Button>
            ))}
          </div>

          <Form.Item name="message_type" hidden>
            <Input />
          </Form.Item>

          {watchedType === 'text' ? (
            <Form.Item name="message_content" label="消息内容">
              <TextArea autoSize={{ minRows: 6, maxRows: 14 }} placeholder="输入要发送的文本内容" />
            </Form.Item>
          ) : (
            <>
              <Upload.Dragger
                beforeUpload={(file) => handleMediaUpload(file as File, activeMessageType)}
                showUploadList={false}
                style={{ marginBottom: 12 }}
              >
                <p className="ant-upload-drag-icon">
                  <UploadOutlined style={{ fontSize: 26 }} />
                </p>
                <p className="ant-upload-text">点击或拖拽上传媒体</p>
              </Upload.Dragger>
              <Form.Item name="media_url" label="媒体链接">
                <Input placeholder="上传后自动回填，也可手动填写 URL" />
              </Form.Item>
              {mediaUrl ? (
                <div style={{ borderRadius: 14, overflow: 'hidden', border: '1px solid rgba(178,34,34,0.18)' }}>
                  {watchedType === 'image' ? (
                    <img src={mediaUrl} alt="preview" style={{ width: '100%', maxHeight: 260, objectFit: 'cover' }} />
                  ) : (
                    <div style={{ padding: 16, color: '#b9a19a' }}>{mediaUrl}</div>
                  )}
                </div>
              ) : null}
            </>
          )}
        </div>
      </Form>
    </Drawer>
  );
};

export default WorkTaskCreateModal;
