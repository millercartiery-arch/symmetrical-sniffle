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
      colorPrimary: brandColor || '#55616c',
      colorInfo: '#476d8a',
      colorSuccess: '#1f8a56',
      colorWarning: '#b37a2a',
      colorError: '#b24b41',
      colorLink: brandColor || '#55616c',
      colorBgBase: theme === 'high-contrast' ? '#07090b' : theme === 'dark' ? '#0d1014' : '#f5f1ec',
      colorBgLayout: theme === 'high-contrast' ? '#090b0d' : theme === 'dark' ? '#11161b' : '#f1ece7',
      colorBgContainer: theme === 'high-contrast' ? '#14181c' : theme === 'dark' ? '#171d22' : '#ffffff',
      colorBorder: theme === 'high-contrast' ? '#273038' : theme === 'dark' ? '#2a333b' : '#e0d6cf',
      colorBorderSecondary: theme === 'high-contrast' ? '#1f2830' : theme === 'dark' ? '#242d34' : '#ebe1db',
      colorText: theme === 'high-contrast' ? '#ffffff' : theme === 'dark' ? '#f1ece8' : '#221c1a',
      colorTextSecondary: theme === 'high-contrast' ? '#c6d0d8' : theme === 'dark' ? '#b7b0ab' : '#675b56',
      colorTextTertiary: theme === 'high-contrast' ? '#98a3ad' : '#8b7e77',
      borderRadius: 14,
      borderRadiusLG: 22,
      fontFamily: "'IBM Plex Sans', 'Segoe UI', sans-serif",
    },
  }), [theme, brandColor]);

  const showDesktopUI = isLoggedIn;
  const resolvedLanguage = i18n.resolvedLanguage || i18n.language || 'en-US';
  const antdLocale = resolvedLanguage === 'zh-CN' || resolvedLanguage.startsWith('zh') ? zhCN : enUS;

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
