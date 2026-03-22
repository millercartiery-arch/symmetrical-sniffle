import React, { useMemo, useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { message } from 'antd';
import { clearAuth, setAuthToken } from '../utils/jwt-auth';
import { apiUrl } from '../api';
import { useTheme } from '../context/ThemeContext';
import { getDefaultAdminRoute, normalizeAppRole } from '../utils/access-control';
import './Login.css';

const createCaptcha = () =>
  Math.random().toString(36).slice(2, 6).toUpperCase();

const Login: React.FC = () => {
  const navigate = useNavigate();
  const { i18n, t } = useTranslation();
  const { theme, setTheme } = useTheme();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [captchaInput, setCaptchaInput] = useState('');
  const [rememberPassword, setRememberPassword] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [captcha, setCaptcha] = useState(() => createCaptcha());

  const isZh = i18n.language === 'zh-CN' || i18n.language.startsWith('zh');
  const titleCopy = t('login.hero_title', { defaultValue: isZh ? 'Cartier&Miller 控制入口' : 'Cartier&Miller Control Access' });
  const subtitleCopy = t('login.hero_copy', {
    defaultValue: isZh
      ? '统一进入账户、消息、代理和任务调度中心。高风险状态会被优先突出，关键链路保持在同一套控制面板内。'
      : 'Unified access to accounts, conversations, proxy routing and task orchestration. High-risk states are surfaced first and key links stay under one control surface.'
  });
  const canSubmit = useMemo(
    () => Boolean(username.trim() && password.trim() && captchaInput.trim()) && !loading,
    [username, password, captchaInput, loading]
  );

  const refreshCaptcha = () => {
    setCaptcha(createCaptcha());
    setCaptchaInput('');
  };

  const toggleTheme = () => {
    setTheme(theme === 'light' ? 'high-contrast' : 'light');
  };

  const handleLogin = async () => {
    if (!username.trim() || !password.trim()) {
      const msg = isZh ? '请输入用户名和密码' : 'Please enter username and password';
      setError(msg);
      message.error(msg);
      return;
    }

    if (captchaInput.trim().toUpperCase() !== captcha) {
      const msg = isZh ? '验证码错误' : 'Captcha incorrect';
      setError(msg);
      message.error(msg);
      refreshCaptcha();
      return;
    }

    setLoading(true);
    setError('');
    try {
      const response = await axios.post(apiUrl('/login'), {
        username: username.trim(),
        password,
      });

      const { token, user } = response.data || {};
      if (!token || !user) {
        throw new Error(isZh ? '登录返回数据不完整' : 'Login response is incomplete');
      }

      setAuthToken(token, {
        id: user.id,
        username: user.username,
        role: user.role,
        tenantId: user.tenantId,
      });

      if (!rememberPassword) {
        setPassword('');
      }

      navigate(getDefaultAdminRoute(normalizeAppRole(user.role)), { replace: true });
    } catch (err: any) {
      clearAuth();
      let msg = err?.response?.data?.error || err?.response?.data?.message || err?.message || (isZh ? '登录失败' : 'Login failed');
      if (typeof msg === 'string' && (msg.includes('CORS') || msg.includes('8080'))) {
        msg = isZh
          ? '无法连接后端。请先启动 backend，再确认 frontend 的 VITE_BACKEND_TARGET 指向本地服务。'
          : 'Backend connection failed. Start the backend first, then confirm VITE_BACKEND_TARGET points to the local service.';
      }
      setError(String(msg));
      message.error(String(msg));
      refreshCaptcha();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="cm-login-shell">
      <div className="cm-login-overlay" />
      <div className="topBar">
        <button
          type="button"
          className="ctrlBtn"
          onClick={() => i18n.changeLanguage(isZh ? 'en-US' : 'zh-CN')}
        >
          {isZh ? 'EN' : '中文'}
        </button>
        <button
          type="button"
          className="ctrlBtn"
          onClick={toggleTheme}
          title={theme === 'light'
            ? t('login.switch_to_contrast', { defaultValue: isZh ? '切换到高对比' : 'Switch to contrast mode' })
            : t('login.switch_to_light', { defaultValue: isZh ? '切换到浅色' : 'Switch to light mode' })}
        >
          {theme === 'light' ? t('login.contrast', { defaultValue: 'Contrast' }) : t('login.light', { defaultValue: 'Light' })}
        </button>
      </div>

      <div className="cm-login-layout">
        <section className="cm-login-hero">
          <div className="cm-login-brand-mark">
            <img src="/favicon.png" alt={t('brand.name', { defaultValue: 'Cartier&Miller' })} />
          </div>
          <div className="cm-kpi-eyebrow">{t('login.secure_operator_access', { defaultValue: 'Secure Operator Access' })}</div>
          <h1 className="cm-login-title cm-brand-title">
            {titleCopy}
          </h1>
          <p className="cm-login-copy">
            {subtitleCopy}
          </p>

          <div className="cm-feature-grid">
            <div className="cm-feature-card">
              <strong>{t('login.routing_health', { defaultValue: 'Routing Health' })}</strong>
              <span>{t('login.routing_health_desc', { defaultValue: isZh ? '代理链路、失败任务和异常账户统一监控。' : 'Proxy health, failed tasks and locked accounts in one monitor.' })}</span>
            </div>
            <div className="cm-feature-card">
              <strong>{t('login.session_stability', { defaultValue: 'Session Stability' })}</strong>
              <span>{t('login.session_stability_desc', { defaultValue: isZh ? '凭证、会话与自动化动作保持连续。' : 'Credentials, sessions and automation actions stay consistent.' })}</span>
            </div>
            <div className="cm-feature-card">
              <strong>{t('login.operator_clarity', { defaultValue: 'Operator Clarity' })}</strong>
              <span>{t('login.operator_clarity_desc', { defaultValue: isZh ? '所有关键入口都以更强层级和反馈呈现。' : 'Primary actions and alerts use stronger hierarchy and feedback.' })}</span>
            </div>
          </div>
        </section>

        <section className="loginCard">
          <div className="cm-login-card-top">
            <div className="cm-login-card-logo">
              <img src="/favicon.png" alt={t('brand.name', { defaultValue: 'Cartier&Miller' })} />
            </div>
            <div>
              <div className="cm-kpi-eyebrow">{t('login.operator_sign_in', { defaultValue: 'Operator Sign In' })}</div>
              <div className="title">{t('login.sign_in_title', { defaultValue: isZh ? '登录控制台' : 'Sign in to control center' })}</div>
            </div>
          </div>

          {error ? <div className="errorText">{error}</div> : null}

          <div className="inputGroup">
            <label htmlFor="login-username" className="fieldLabel">
              {t('auth.username', { defaultValue: isZh ? '用户名' : 'Username' })}
            </label>
            <input
              id="login-username"
              name="username"
              className="input"
              placeholder={t('login.username_placeholder', { defaultValue: isZh ? '输入管理员账号' : 'Enter your operator username' })}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
              autoComplete="username"
            />
          </div>

          <div className="inputGroup">
            <label htmlFor="login-password" className="fieldLabel">
              {t('auth.password', { defaultValue: isZh ? '密码' : 'Password' })}
            </label>
            <input
              id="login-password"
              name="password"
              className="input"
              type={showPassword ? 'text' : 'password'}
              placeholder={t('login.password_placeholder', { defaultValue: isZh ? '输入登录密码' : 'Enter your password' })}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
              autoComplete="current-password"
            />
            <button
              type="button"
              className="eye"
              onClick={() => setShowPassword((value) => !value)}
              aria-label={showPassword ? t('login.hide_password', { defaultValue: isZh ? '隐藏密码' : 'Hide password' }) : t('login.show_password', { defaultValue: isZh ? '显示密码' : 'Show password' })}
            >
              {showPassword ? t('login.hide_short', { defaultValue: 'Hide' }) : t('login.show_short', { defaultValue: 'Show' })}
            </button>
          </div>

          <div className="inputGroup">
            <label htmlFor="login-captcha" className="fieldLabel">
              {t('login.captcha_label', { defaultValue: isZh ? '验证码校验' : 'Captcha Verification' })}
            </label>
            <div className="captchaRow">
              <input
                id="login-captcha"
                name="captcha"
                className="captchaInput"
                placeholder={t('login.captcha_placeholder', { defaultValue: isZh ? '输入验证码' : 'Enter captcha' })}
                value={captchaInput}
                onChange={(e) => setCaptchaInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                autoComplete="one-time-code"
              />
              <button
                type="button"
                className="captchaBox"
                onClick={refreshCaptcha}
                title={t('login.refresh_captcha', { defaultValue: isZh ? '点击刷新验证码' : 'Click to refresh captcha' })}
                aria-label={t('login.refresh_captcha', { defaultValue: isZh ? '刷新验证码' : 'Refresh captcha' })}
              >
                {captcha}
              </button>
            </div>
          </div>

          <div className="options">
            <label htmlFor="login-remember">
              <input
                id="login-remember"
                name="remember"
                type="checkbox"
                checked={rememberPassword}
                onChange={(e) => setRememberPassword(e.target.checked)}
              />{' '}
              {t('login.remember_password', { defaultValue: isZh ? '记住密码' : 'Remember password' })}
            </label>
            <button type="button" className="linkBtn" onClick={refreshCaptcha}>
              {t('login.refresh_captcha_short', { defaultValue: isZh ? '换一张验证码' : 'Refresh captcha' })}
            </button>
          </div>

          <button
          type="button"
          className="loginBtn"
          disabled={!canSubmit}
          onClick={handleLogin}
        >
            {loading ? t('login.logging_in', { defaultValue: isZh ? '登录中...' : 'Logging in...' }) : t('login.enter_control_center', { defaultValue: isZh ? '进入控制台' : 'Enter Control Center' })}
          </button>

          <div className="cm-login-footnote">
            {t('login.footnote', {
              defaultValue: isZh
                ? '登录即表示你已知悉当前隐私与服务协议更新。'
                : 'Signing in confirms awareness of the latest privacy and service agreement update.'
            })}
          </div>
        </section>
      </div>
    </div>
  );
};

export default Login;
