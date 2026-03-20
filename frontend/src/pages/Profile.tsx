import React from 'react';
import { Card, Tabs } from 'antd';
import { UserOutlined, SettingOutlined } from '@ant-design/icons';
import AutoUpdateCard from '../components/AutoUpdateCard';
import { useTranslation } from 'react-i18next';

/**
 * 个人中心 & 设置 - 合并页面
 * 包含：
 * - 个人信息（自动更新等）
 * - 应用设置
 * 
 * 通过 Tabs 切换，避免两个功能相同的独立页面
 */
const Profile: React.FC = () => {
  const { t } = useTranslation();

  return (
    <div style={{ padding: 13 }}>
      <Card style={{ maxWidth: 560 }}>
        <Tabs
          size="small"
          items={[
            {
              key: 'profile',
              label: t('common.profile', { defaultValue: '个人中心' }),
              icon: <UserOutlined />,
              children: (
                <AutoUpdateCard title={t('profile.auto_update', { defaultValue: '自动更新' })} />
              ),
            },
            {
              key: 'settings',
              label: t('common.settings', { defaultValue: '设置' }),
              icon: <SettingOutlined />,
              children: (
                <AutoUpdateCard title={t('system.app_settings', { defaultValue: '应用设置' })} />
              ),
            },
          ]}
        />
      </Card>
    </div>
  );
};

export default Profile;
