/* ------------------- src/layouts/AdminLayout.tsx ------------------- */
import React, {
  useState,
  useCallback,
  useMemo,
} from 'react';
import {
  Layout,
  Menu,
  Dropdown,
  Avatar,
  Button,
  Typography,
  theme,
  message,
  Grid,
} from 'antd';
import {
  DashboardOutlined,
  TeamOutlined,
  MessageOutlined,
  PlusOutlined,
  GlobalOutlined,
  UserOutlined,
  LogoutOutlined,
  HeartFilled,
  RiseOutlined,
} from '@ant-design/icons';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { clearAuth } from '../utils/jwt-auth';
import WorkTaskCreateModal from '../components/WorkTaskCreateModal';

const { Header, Sider, Content } = Layout;
const { Text } = Typography;
const { useToken } = theme;
const { useBreakpoint } = Grid;

/* ---------- 退出登录的自定义 Hook ---------- */
const useLogout = (navigate: ReturnType<typeof useNavigate>) => {
  const { t } = useTranslation();
  return useCallback(() => {
    clearAuth();
    message.info(t('common.logout_success') ?? '已登出');
    // replace 防止在登录页后点后退仍能看到受保护页面
    navigate('/login', { replace: true });
  }, [navigate, t]);
};

/* --------------------- 主布局组件 --------------------- */
const AdminLayout: React.FC = () => {
  const { token } = useToken();
  const screens = useBreakpoint();
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();

  // ------------------- 状态 -------------------
  const [taskModalOpen, setTaskModalOpen] = useState(false);

  // ------------------- UI 计算 -------------------
  const isSiderCollapsed = !screens.xl;      // xl 以上展开，以下折叠
  const isCompact = !screens.xl;            // 按钮文字在窄屏下简化
  const isNarrow = !screens.lg;             // Header、Sider 里的间距
  const siderWidth = screens.xl ? 248 : screens.lg ? 92 : 78;

  // 选中的菜单项（兼容子路由 /admin/tasks/42 等）
  const selectedKey = useMemo(() => {
    const parts = location.pathname.split('/');
    return parts.slice(0, 3).join('/');
  }, [location.pathname]);

  // 路由跳转函数，useCallback 防止每次渲染产生新引用
  const navigateTo = useCallback((path: string) => navigate(path), [navigate]);

  // 退出登录
  const handleLogout = useLogout(navigate);

  // ------------------- 菜单项（Memo） -------------------
  const menuItems = useMemo(() => [
    {
      key: '/admin/dashboard',
      icon: <DashboardOutlined />,
      label: t('menu.dashboard', { defaultValue: '账户概览' }),
    },
    {
      key: '/admin/conversations',
      icon: <MessageOutlined />,
      label: t('menu.chat', { defaultValue: '消息管理' }),
    },
    {
      key: '/admin/accounts',
      icon: <TeamOutlined />,
      label: t('menu.accounts', { defaultValue: '资源管理' }),
    },
  ], [t]);

  // ------------------- 样式对象 -------------------
  const layoutStyle: React.CSSProperties = {
    minHeight: 'calc(100vh - 34px)',
    height:    'calc(100vh - 34px)',
    overflow: 'hidden',
  };

  const headerStyle: React.CSSProperties = {
    background: 'rgba(255, 255, 255, 0.9)',
    borderBottom: `1px solid ${token.colorBorderSecondary}`,
    padding: isNarrow ? '10px 12px' : '0 24px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    flexWrap: 'wrap',
    minHeight: isNarrow ? 72 : 64,
    height: 'auto',
  };

  const contentStyle: React.CSSProperties = {
    margin: 13,
    background: 'rgba(255, 255, 255, 0.9)',
    borderRadius: token.borderRadiusLG,
    minHeight: 400,
    overflow: 'auto',
  };

  // ------------------- 渲染 -------------------
  return (
    <Layout style={layoutStyle} className="cm-shell">
      {/* ----------- 侧边栏 ----------- */}
      <Sider
        collapsible
        collapsed={isSiderCollapsed}
        collapsedWidth={56}
        width={siderWidth}
        theme="dark"
        className="cm-sidebar"
        style={{
          background: 'linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(248, 241, 238, 1))',
          borderRight: `1px solid ${token.colorBorderSecondary}`,
          paddingTop: isNarrow ? 12 : 16,
          boxShadow: '1px 0 24px rgba(0, 0, 0, 0.18)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* LOGO */}
        <div
          style={{
            textAlign: 'center',
            marginBottom: isNarrow ? 10 : 16,
            paddingInline: 4,
          }}
        >
          <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: isSiderCollapsed ? 'center' : 'flex-start',
                gap: 12,
                padding: isSiderCollapsed ? 0 : '10px 14px',
                borderRadius: 18,
                border: '1px solid rgba(178, 34, 34, 0.14)',
                background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.94), rgba(255, 238, 238, 0.72))',
              }}
            >
            <div
              style={{
                width: isNarrow ? 34 : 38,
                height: isNarrow ? 34 : 38,
                borderRadius: 18,
                background: 'linear-gradient(135deg, #8B0000, #B22222)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff',
                fontWeight: 'bold',
                fontSize: isNarrow ? 12 : 13,
                boxShadow: '0 12px 24px rgba(139, 0, 0, 0.32)',
              }}
            >
              CM
            </div>
            {!isSiderCollapsed && (
              <div style={{ textAlign: 'left' }}>
                <div className="cm-brand-title" style={{ color: '#231815', fontSize: 14, fontWeight: 700 }}>
                  Cartier&Miller
                </div>
                <Text style={{ color: '#6f5750', fontSize: 11 }}>
                  {t('shell.control_center', { defaultValue: 'Control Center' })}
                </Text>
              </div>
            )}
          </div>
        </div>

        {/* 菜单 */}
        <Menu
          mode="inline"
          selectedKeys={[selectedKey]}
          inlineCollapsed={isSiderCollapsed}
          items={menuItems}
          onClick={({ key }) => navigateTo(key as string)}
          style={{ border: 'none' }}
          className="app-sider-menu"
        />

        {!isSiderCollapsed && (
          <div style={{ marginTop: 'auto', padding: 16 }}>
            <div className="cm-health-pill" style={{ background: 'rgba(255,255,255,0.9)' }}>
              <HeartFilled style={{ color: '#16a34a' }} />
              <span>{t('shell.system_health', { defaultValue: 'System Health 98%' })}</span>
            </div>
          </div>
        )}
      </Sider>

      {/* ----------- 主体（Header + Content） ----------- */}
      <Layout style={{ minWidth: 0, overflow: 'hidden' }}>
        {/* Header */}
        <Header style={headerStyle} className="cm-header">
          <div>
            <Text strong className="cm-brand-title" style={{ fontSize: isNarrow ? 16 : 18, color: '#231815' }}>
              Cartier&Miller
            </Text>
            <div>
              <Text style={{ color: '#6f5750', fontSize: 12 }}>
                {t('shell.subtitle', {
                  defaultValue: 'Secure operations dashboard for accounts, chat routing and proxy orchestration.',
                })}
              </Text>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <div className="cm-health-pill" style={{ marginRight: 4 }}>
              <RiseOutlined style={{ color: '#3f69ff' }} />
              <span>{t('shell.proxy_status_stable', { defaultValue: 'Proxy Status Stable' })}</span>
            </div>
            {/* 语言切换 */}
            <Dropdown
              menu={{
                items: [
                  { key: 'en-US', label: 'English', onClick: () => i18n.changeLanguage('en-US') },
                  { key: 'zh-CN', label: '中文', onClick: () => i18n.changeLanguage('zh-CN') },
                ],
              }}
            >
              <Button
                type="text"
                icon={<GlobalOutlined />}
                style={{ color: '#6f5750' }}
                aria-label={t('common.language') ?? '语言切换'}
              >
                {i18n.language === 'zh-CN' ? '中文' : 'English'}
              </Button>
            </Dropdown>

            {/* 创建任务按钮 */}
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setTaskModalOpen(true)}
              className="cm-primary-button"
              style={{ borderRadius: token.borderRadiusSM, fontWeight: 600 }}
            >
              {isCompact ? t('tasks.create_short') ?? '创建' : t('tasks.create') ?? '创建任务'}
            </Button>

            {/* 个人中心 & 退出 */}
            <Dropdown
              menu={{
                items: [
                  {
                    key: 'profile',
                    icon: <UserOutlined />,
                    label: t('common.profile') ?? '个人中心',
                    onClick: () => navigateTo('/admin/profile'),
                  },
                  { type: 'divider' },
                  {
                    key: 'logout',
                    icon: <LogoutOutlined />,
                    label: t('common.logout') ?? '退出登录',
                    danger: true,
                    onClick: handleLogout,
                  },
                ],
              }}
              placement="bottomRight"
              arrow
            >
              <div
                style={{ cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                aria-label={t('common.profile') ?? '个人中心'}
              >
                <Avatar
                  style={{
                    backgroundColor: token.colorPrimary,
                    boxShadow: '0 12px 24px rgba(139, 0, 0, 0.24)',
                  }}
                  icon={<UserOutlined />}
                />
              </div>
            </Dropdown>
          </div>
        </Header>

        {/* 内容区 */}
        <Content style={contentStyle}>
          <Outlet />
        </Content>
      </Layout>

      {/* -------------------- 模态框 & 抽屉 -------------------- */}
      {/* 任务创建弹窗 */}
      <WorkTaskCreateModal
        open={taskModalOpen}
        onClose={() => setTaskModalOpen(false)}
        onSuccess={() => {
          /* 成功回调（可选：刷新任务列表、toast等） */
        }}
      />
    </Layout>
  );
};

export default AdminLayout;
