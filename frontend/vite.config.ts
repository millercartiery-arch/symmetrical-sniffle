import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import viteCompression from 'vite-plugin-compression';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, '');
  const devPort = Number(env.VITE_DEV_PORT || 8080);
  // 开发模式默认代理到本地后端，打通 npm run dev；生产或显式配置时用 env
  const backendTarget =
    (env.VITE_BACKEND_TARGET && env.VITE_BACKEND_TARGET.trim()) ||
    (mode === 'development' ? 'http://127.0.0.1:3000' : 'https://hkd.llc');

  const basePath = (env.VITE_BASE_PATH || '').trim() || '/';
  // 网页部署：base '/'。仅 Tauri 打包（npm run build:tauri）时用相对路径 './'，否则网页 /assets/ 会 404
  const isTauriBuild = mode === 'tauri';
  const base =
    mode === 'production' || isTauriBuild
      ? isTauriBuild
        ? './'
        : (basePath === '/' ? '/' : basePath.replace(/\/?$/, '/'))
      : '/';
  return {
    root: __dirname,
    base,
    define: {
      'import.meta.env.VITE_TAURI': JSON.stringify(env.VITE_TAURI || '0'),
    },
    plugins: [
      react(),
      viteCompression({
        verbose: true,
        disable: false,
        threshold: 10240,
        algorithm: 'gzip',
        ext: '.gz',
      })
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
    },
    server: {
      host: '0.0.0.0', // 允许本机域名、局域网 IP 访问
      strictPort: false, // 端口被占用时自动尝试下一端口
      port: devPort,
      proxy: {
        '/api': {
          target: backendTarget,
          changeOrigin: true,
          secure: false,
        },
        '/socket.io': {
          target: backendTarget,
          changeOrigin: true,
          ws: true,
          secure: false,
        },
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            'vendor-react': ['react', 'react-dom', 'react-router-dom'],
            'vendor-antd': ['antd'],
            'vendor-antd-icons': ['@ant-design/icons'],
            'vendor-charts': ['@ant-design/charts'],
            'vendor-utils': ['axios', 'i18next', 'react-i18next', 'socket.io-client'],
          },
        },
      },
      chunkSizeWarningLimit: 1000,
    },
  };
});
