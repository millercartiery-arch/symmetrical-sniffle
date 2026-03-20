// src/App.tsx
import React, { useEffect, useMemo, lazy, Suspense } from 'react';
import { ConfigProvider, theme as antTheme, Spin } from 'antd';
import { Routes, Route, Navigate, useLocation, Outlet } from 'react-router-dom';
import zhCN from 'antd/locale/zh_CN';
import enUS from 'antd/locale/en_US';
import { useTranslation } from 'react-i18next';

import { trackPageView } from './utils/analytics';
import './styles/global-polish.css';

import ProtectedRoute from './components/ProtectedRoute';
import RouteErrorFallback from './components/RouteErrorFallback';
import { isAuthenticated, getUserRole } from './utils/jwt-auth';

import AdminLayout from './layouts/AdminLayout';
import DesktopTitleBar from './components/DesktopTitleBar';
import UpdatePromptModal from './components/UpdatePromptModal';
import PrivacyModal from './components/PrivacyModal';
import { useTheme } from './context/ThemeContext';

const Login = lazy(() => import('./pages/Login'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Chat = lazy(() => import('./pages/Chat'));
const AccountManager = lazy(() => import('./pages/AccountManager'));
const TaskList = lazy(() => import('./pages/TaskList'));
const Profile = lazy(() => import('./pages/Profile'));
const PrivacyPolicy = lazy(() => import('./pages/PrivacyPolicy'));
const ChildrenPrivacy = lazy(() => import('./pages/ChildrenPrivacy'));
const DoNotSell = lazy(() => import('./pages/DoNotSell'));
const NotFound = lazy(() => import('./pages/NotFound'));

const App = () => {
  const location = useLocation();
  const { theme, brandColor } = useTheme();
  const { i18n } = useTranslation();

  useEffect(() => {
    trackPageView(location.pathname);
  }, [location.pathname]);

  const isLoggedIn = isAuthenticated();
  const userRole = getUserRole();

  const defaultRoute = useMemo(
    () => (isLoggedIn ? '/admin/accounts' : '/login'),
    [isLoggedIn]
  );

  const antdTheme = useMemo(() => ({
    algorithm:
      theme === 'dark' || theme === 'high-contrast'
        ? antTheme.darkAlgorithm
        : antTheme.defaultAlgorithm,
    token: {
      colorPrimary: brandColor || '#8B0000',
      colorInfo: '#3f69ff',
      colorSuccess: '#16a34a',
      colorWarning: '#d97706',
      colorError: '#b22222',
      colorLink: brandColor || '#8B0000',
      colorBgBase: theme === 'high-contrast' ? '#070707' : theme === 'dark' ? '#131313' : '#f8f2f0',
      colorBgLayout: theme === 'high-contrast' ? '#0a0a0a' : theme === 'dark' ? '#111111' : '#f3ebe8',
      colorBgContainer: theme === 'high-contrast' ? '#151515' : theme === 'dark' ? '#181818' : '#ffffff',
      colorBorder: theme === 'high-contrast' ? '#352020' : theme === 'dark' ? '#2d2d2d' : '#e6d9d5',
      colorBorderSecondary: theme === 'high-contrast' ? '#2a1a1a' : theme === 'dark' ? '#262626' : '#efe3df',
      colorText: theme === 'high-contrast' ? '#f6ece7' : theme === 'dark' ? '#ececec' : '#221918',
      colorTextSecondary: theme === 'high-contrast' ? '#c5aea8' : theme === 'dark' ? '#b3b3b3' : '#6f5750',
      colorTextTertiary: theme === 'high-contrast' ? '#8d7570' : undefined,
      borderRadius: 16,
      borderRadiusLG: 24,
      fontFamily: "'IBM Plex Sans', 'Segoe UI', sans-serif",
    },
  }), [theme, brandColor]);

  const showDesktopUI = isLoggedIn;
  const antdLocale = i18n.language === 'zh-CN' || i18n.language.startsWith('zh') ? zhCN : enUS;

  const Loader = (
    <Spin
      size="large"
      tip="Loading…"
      style={{ display: 'block', margin: '10% auto' }}
    />
  );

  return (
    <ConfigProvider theme={antdTheme} locale={antdLocale}>
      {showDesktopUI && <DesktopTitleBar />}
      {showDesktopUI && <UpdatePromptModal />}
      <PrivacyModal />

      <Suspense fallback={Loader}>
        <Routes>
          <Route element={<Outlet />} errorElement={<RouteErrorFallback />}>
            <Route path="/login" element={<Login />} />
            <Route path="/" element={<Navigate to={defaultRoute} replace />} />

            {/* Public compliance pages (opened from PrivacyModal) */}
            <Route path="/privacy-policy" element={<PrivacyPolicy />} />
            <Route path="/children-privacy" element={<ChildrenPrivacy />} />
            <Route path="/privacy/do-not-sell" element={<DoNotSell />} />

            <Route
              element={
                <ProtectedRoute allowedRoles={['admin', 'operator']}>
                  <AdminLayout />
                </ProtectedRoute>
              }
            >
              <Route path="/admin/dashboard" element={<Dashboard />} />
              <Route path="/admin/accounts" element={<AccountManager />} />
              <Route path="/admin/conversations" element={<Chat />} />
              {/* 任务列表从侧边栏移除，但路由保留以兼容旧书签 */}
              <Route path="/admin/tasks" element={<TaskList />} />
              <Route path="/admin/profile" element={<Profile />} />
              {/* /admin/settings 重定向到 profile（设置已合并） */}
              <Route path="/admin/settings" element={<Profile />} />
            </Route>

            <Route path="/404" element={<NotFound />} />
            <Route path="*" element={<Navigate to="/404" replace />} />
          </Route>
        </Routes>
      </Suspense>
    </ConfigProvider>
  );
};

export default App;
