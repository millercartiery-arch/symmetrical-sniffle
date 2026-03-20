import React, { useEffect, useState } from 'react';
import { Modal, Button, Typography } from 'antd';
import { DownloadOutlined } from '@ant-design/icons';
import {
  checkDesktopUpdate,
  installDesktopUpdate,
  isTauriRuntime,
  onDesktopUpdaterEvent,
  type DesktopUpdateInfo,
} from '../utils/desktop-updater';

const { Text } = Typography;

/** 应用内全局更新提示：启动时检测，有更新则弹窗，支持一键安装 */
const UpdatePromptModal: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<DesktopUpdateInfo | null>(null);
  const [installing, setInstalling] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [errorText, setErrorText] = useState('');

  useEffect(() => {
    if (!isTauriRuntime()) return;
    const t = setTimeout(() => {
      checkDesktopUpdate().then((result) => {
        if (result.available && result.manifest) {
          setUpdateInfo(result.manifest);
          setOpen(true);
        }
      });
    }, 1500);
    return () => clearTimeout(t);
  }, []);

  const handleInstall = async () => {
    if (!updateInfo) return;
    setInstalling(true);
    setStatusText('正在准备更新...');
    setErrorText('');
    try {
      const unlisten = await onDesktopUpdaterEvent(({ error, status }) => {
        setStatusText(
          status === 'PENDING'
            ? '正在下载更新包...'
            : status === 'DONE'
              ? '更新下载完成，正在启动安装程序...'
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
        setStatusText('安装程序已启动，请按提示完成覆盖安装。');
        setOpen(false);
      } finally {
        unlisten();
      }
    } catch (err) {
      setErrorText(err instanceof Error ? err.message : '安装更新失败');
    } finally {
      setInstalling(false);
    }
  };

  return (
    <Modal
      title="发现新版本"
      open={open}
      onCancel={() => setOpen(false)}
      footer={[
        <Button key="later" onClick={() => setOpen(false)}>
          稍后
        </Button>,
        <Button
          key="update"
          type="primary"
          icon={<DownloadOutlined />}
          loading={installing}
          onClick={handleInstall}
        >
          立即更新
        </Button>,
      ]}
      maskClosable={!installing}
      closable={!installing}
      width={400}
    >
      {updateInfo && (
        <>
          <Text strong>版本 {updateInfo.version}</Text>
          {updateInfo.body && (
            <div style={{ marginTop: 8 }}>
              <Text type="secondary">{updateInfo.body}</Text>
            </div>
          )}
          <div style={{ marginTop: 12 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {statusText || '点击「立即更新」将自动下载并启动安装程序，覆盖安装后重启即可。'}
            </Text>
          </div>
          {errorText && (
            <Text type="danger" style={{ display: 'block', marginTop: 8, fontSize: 12 }}>
              {errorText}
            </Text>
          )}
        </>
      )}
    </Modal>
  );
};

export default UpdatePromptModal;
