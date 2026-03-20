import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import 'antd/dist/reset.css';
import './styles/global.css';
import './styles/theme.css';
import './components/DesktopTitleBar.css';
import { ThemeProvider } from './context/ThemeContext';
import { TauriAuthManager } from './utils/tauri-auth-manager';
import { AppErrorBoundary } from './components/AppErrorBoundary';

// 检查是否在 Tauri 环境中
const isTauri = '__TAURI__' in window;
if (isTauri) document.body.classList.add('tauri-desktop');

const SAFETY_RENDER_MS = 12000;
let didRender = false;

/**
 * 初始化应用（带超时兜底，避免白屏）
 */
async function initApp() {
  const safety = window.setTimeout(() => {
    if (!didRender) {
      console.warn('[App] 启动超时，强制渲染');
      didRender = true;
      renderApp();
    }
  }, SAFETY_RENDER_MS);

  if (isTauri) {
    console.log('[App] 🖥️ 在 Tauri 环境中运行');
    try {
      await TauriAuthManager.init();
      console.log('[App] ✅ Tauri 初始化完成');
    } catch (err) {
      console.error('[App] ❌ Tauri 初始化失败:', err);
    }
  } else {
    console.log('[App] 🌐 在浏览器环境中运行');
  }

  clearTimeout(safety);
  didRender = true;
  renderApp();
}

function renderApp() {
  if (typeof window !== 'undefined' && window.__APP_LOAD_TIMEOUT__) {
    clearTimeout(window.__APP_LOAD_TIMEOUT__);
  }

  const rawBaseUrl = String(import.meta.env.BASE_URL || '/').trim();
  const routerBasename = (() => {
    if (!rawBaseUrl || rawBaseUrl === '.' || rawBaseUrl === './') {
      return '/';
    }
    const normalized = rawBaseUrl.startsWith('/')
      ? rawBaseUrl
      : `/${rawBaseUrl.replace(/^\.?\//, '')}`;
    return normalized.replace(/\/+$/, '') || '/';
  })();

  const Root: React.FC = () => {
    return (
      <ThemeProvider>
        <BrowserRouter basename={routerBasename}>
          <App />
        </BrowserRouter>
      </ThemeProvider>
    );
  };

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <AppErrorBoundary>
        <Root />
      </AppErrorBoundary>
    </React.StrictMode>
  );
}

// 启动应用
initApp().catch(err => {
  console.error('[App] 启动失败:', err);
  if (!didRender) {
    didRender = true;
    const root = document.getElementById('root');
    if (root) {
      root.innerHTML =
        '<div style="padding:24px;font-family:sans-serif;max-width:560px;margin:40px auto;">' +
        '<p style="color:#c00;font-weight:600;">应用加载失败</p>' +
        '<pre style="background:#f5f5f5;padding:12px;overflow:auto;font-size:12px;">' +
        (err instanceof Error ? err.message : String(err)) + '</pre>' +
        '<p style="color:#475569;">请打开开发者工具 (F12) 查看 Console 报错。</p>' +
        '<button onclick="location.reload()" style="padding:8px 16px;cursor:pointer;margin-top:8px;">重新加载</button></div>';
      root.style.display = 'block';
    }
  }
});

// Service Worker 已禁用：使用 serve -s dist 时 /sw.js 会回退到 index.html，MIME 为 text/html 导致注册失败。
// 若需 PWA，请确保构建产出 sw.js 并由服务器正确提供（或使用 Vite 开发服务器）。
// if ('serviceWorker' in navigator) {
//   window.addEventListener('load', () => {
//     navigator.serviceWorker.register('/sw.js').then(registration => {
//       console.log('SW registered: ', registration);
//     }).catch(registrationError => {
//       console.log('SW registration failed: ', registrationError);
//     });
//   });
// }
