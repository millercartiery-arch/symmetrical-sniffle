import React, { useEffect, useState } from 'react';
import { Card, Button, Space, Typography, Alert, message } from 'antd';
import { ReloadOutlined, DownloadOutlined } from '@ant-design/icons';
import {
  checkDesktopUpdate,
  installDesktopUpdate,
  getDesktopVersion,
  isTauriRuntime,
  onDesktopUpdaterEvent,
  type DesktopUpdateInfo,
} from '../utils/desktop-updater';

const { Text } = Typography;

const APP_VERSION_FALLBACK = '1.0.1';

/** 自动更新卡片：可在个人中心、设置等页面复用 */
const AutoUpdateCard: React.FC<{ title?: string; style?: React.CSSProperties }> = ({
  title = '自动更新',
  style,
}) => {
  const [currentVersion, setCurrentVersion] = useState<string>(APP_VERSION_FALLBACK);
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<DesktopUpdateInfo | null>(null);
  const [statusText, setStatusText] = useState('');
  const [errorText, setErrorText] = useState('');

  useEffect(() => {
    if (isTauriRuntime()) {
      getDesktopVersion().then((v) => {
        if (v) setCurrentVersion(v);
      });
    }
  }, []);

  const handleCheckUpdate = async () => {
    if (!isTauriRuntime()) {
      message.info('当前为网页端，仅桌面版支持应用内更新');
      return;
    }
    setChecking(true);
    setErrorText('');
    setUpdateAvailable(false);
    setUpdateInfo(null);
    try {
      const result = await checkDesktopUpdate();
      if (result.error) {
        setErrorText(result.error);
        return;
      }
      if (result.available && result.manifest) {
        setUpdateAvailable(true);
        setUpdateInfo(result.manifest);
        message.success(`发现新版本 ${result.manifest.version}`);
      } else {
        message.success('当前已是最新版本');
      }
    } finally {
      setChecking(false);
    }
  };

  const handleInstallUpdate = async () => {
    setInstalling(true);
    setStatusText('正在准备更新...');
    setErrorText('');
    try {
      const unlisten = await onDesktopUpdaterEvent(({ error, status }) => {
        setStatusText(
          status === 'PENDING'
            ? '正在下载更新包...'
            : status === 'DONE'
              ? '更新下载完成，正在启动安装...'
              : status === 'UPTODATE'
                ? '当前已是最新版本'
                : status === 'ERROR'
                  ? '更新失败'
                  : `更新状态：${status}`
        );
        if (error) setErrorText(error);
      });
      try {
        await installDesktopUpdate();
        message.success('更新包已下载，安装程序即将启动，请按提示完成覆盖安装');
        setUpdateAvailable(false);
        setUpdateInfo(null);
      } finally {
        unlisten();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '安装更新失败';
      setErrorText(msg);
      message.error(msg);
    } finally {
      setInstalling(false);
      setStatusText('');
    }
  };

  return (
    <Card
      type="inner"
      title={title}
      style={{ marginBottom: 16, ...style }}
      extra={
        isTauriRuntime() ? (
          <Button
            size="small"
            icon={<ReloadOutlined />}
            loading={checking}
            onClick={handleCheckUpdate}
          >
            检查更新
          </Button>
        ) : null
      }
    >
      <Space direction="vertical" style={{ width: '100%' }} size={12}>
        <Text type="secondary">
          当前版本：<Text strong>{currentVersion}</Text>
          {!isTauriRuntime() && '（网页端）'}
        </Text>

        {updateAvailable && updateInfo && (
          <Alert
            type="info"
            showIcon
            message={`新版本 ${updateInfo.version} 可安装`}
            description={
              updateInfo.body || '更新后将在应用内直接覆盖安装，无需重新下载安装包。'
            }
            action={
              <Button
                type="primary"
                size="small"
                icon={<DownloadOutlined />}
                loading={installing}
                onClick={handleInstallUpdate}
              >
                立即更新（覆盖安装）
              </Button>
            }
          />
        )}

        {statusText && <Text type="secondary">{statusText}</Text>}
        {errorText && (
          <Alert type="error" showIcon message="更新失败" description={errorText} />
        )}

        {isTauriRuntime() && !updateAvailable && !checking && (
          <Text type="secondary" style={{ fontSize: 12 }}>
            点击「检查更新」获取最新版本，若有更新可直接在应用内覆盖升级，无需重新下载安装包。
          </Text>
        )}
      </Space>
    </Card>
  );
};

export default AutoUpdateCard;
