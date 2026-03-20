import axios, { type AxiosRequestConfig } from 'axios';
import { message } from 'antd';
import { getAuthToken, setAuthToken, clearAuth } from './utils/jwt-auth';

declare module 'axios' {
  interface InternalAxiosRequestConfig {
    _retry?: boolean;
    _isRefresh?: boolean;
  }
}

let isShowingError = false; // 弹窗锁

// 未显式配置时使用相对路径 /api：开发走 Vite 代理，生产走当前域名，支持用 IP 或域名访问
const apiBaseEnv = import.meta.env.VITE_API_BASE_URL;
const useRelativeApi =
  apiBaseEnv === undefined || String(apiBaseEnv).trim() === '';
const rawApiBase = useRelativeApi
  ? '/api'
  : String(apiBaseEnv || 'https://hkd.llc/api').trim();
const normalizedApiBase = rawApiBase.replace(/\/+$/, '') || '/api';
const baseHasApiSuffix = /\/api$/i.test(normalizedApiBase);

const normalizePath = (path: string) => {
  const withLeadingSlash = path.startsWith('/') ? path : `/${path}`;
  if (baseHasApiSuffix) {
    return withLeadingSlash.replace(/^\/api(?=\/|$)/i, '') || '/';
  }
  return withLeadingSlash;
};

export const apiUrl = (path: string) => `${normalizedApiBase}${normalizePath(path)}`;

const api = axios.create({
  baseURL: normalizedApiBase,
  timeout: 25000, // 25s，避免弱网或服务器冷启动时误报超时
});

type PxTokenCache = {
  token: string;
  expiresAt: number;
};

let pxTokenCache: PxTokenCache | null = null;

const PX_DEVICE_STORAGE_KEYS = {
  fp: 'px_device_fp',
  model: 'px_device_model',
  os: 'px_device_os',
  osVersion: 'px_device_os_version',
  uuid: 'px_device_uuid',
  vid: 'px_device_vid',
};

const ensureStoredValue = (key: string, fallbackFactory: () => string) => {
  const existing = localStorage.getItem(key);
  if (existing && existing.trim()) return existing;
  const next = fallbackFactory();
  localStorage.setItem(key, next);
  return next;
};

const getDeviceHeaders = () => {
  const fp = ensureStoredValue(PX_DEVICE_STORAGE_KEYS.fp, () => crypto.randomUUID().replace(/-/g, ''));
  const uuid = ensureStoredValue(PX_DEVICE_STORAGE_KEYS.uuid, () => crypto.randomUUID());
  const vid = ensureStoredValue(PX_DEVICE_STORAGE_KEYS.vid, () => crypto.randomUUID().replace(/-/g, ''));
  const model = ensureStoredValue(PX_DEVICE_STORAGE_KEYS.model, () => 'WebClient');
  const os = ensureStoredValue(PX_DEVICE_STORAGE_KEYS.os, () => 'Web');
  const osVersion = ensureStoredValue(PX_DEVICE_STORAGE_KEYS.osVersion, () => navigator.userAgent.slice(0, 40));

  return {
    'X-PX-DEVICE-FP': fp,
    'X-PX-DEVICE-MODEL': model,
    'X-PX-OS': os,
    'X-PX-OS-VERSION': osVersion,
    'X-PX-UUID': uuid,
    'X-PX-VID': vid,
  };
};

const shouldSkipPxFlow = (url?: string) => {
  if (!url) return false;
  return url.includes('/v1/px/token') || url.includes('/v1/px/sign');
};

const getPxToken = async (authToken: string) => {
  if (pxTokenCache && pxTokenCache.expiresAt > Date.now() + 30_000) {
    return pxTokenCache.token;
  }

  const resp = await fetch(apiUrl('/api/v1/px/token/issue'), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${authToken}`,
    },
  });

  if (!resp.ok) {
    throw new Error('Failed to issue PX token');
  }

  const data = await resp.json();
  const expiresIn = Number(data.expires_in || 600);
  pxTokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + expiresIn * 1000,
  };
  return pxTokenCache.token;
};

const getPxSignature = async (authToken: string, payload: any) => {
  const resp = await fetch(apiUrl('/api/v1/px/sign'), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${authToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload || {}),
  });

  if (!resp.ok) {
    throw new Error('Failed to sign request payload');
  }

  return resp.json();
};

api.interceptors.request.use(async (config) => {
  // 使用新的 JWT token 系统
  const token = getAuthToken();
  if (token) {
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${token}`;
  }

  const method = (config.method || 'get').toLowerCase();
  const isMessageSend = method === 'post' && Boolean(config.url?.includes('/messages'));
  if (!isMessageSend || shouldSkipPxFlow(config.url) || !token) {
    return config;
  }

  const payload = config.data || {};
  const pxToken = await getPxToken(token);
  const { timestamp, nonce, signature } = await getPxSignature(token, payload);

  config.headers = config.headers || {};
  config.headers['X-PX-AUTHORIZATION'] = `Bearer ${pxToken}`;
  Object.assign(config.headers, getDeviceHeaders());
  config.data = {
    ...payload,
    timestamp,
    nonce,
    signature,
  };

  return config;
});

api.interceptors.response.use(
  (response) => response.data,
  async (error) => {
    const originalRequest = error?.config as AxiosRequestConfig & { _retry?: boolean; _isRefresh?: boolean };
    const status = error?.response?.status;
    const errorMsg = error.response?.data?.error || error.response?.data?.message || error.message || "Unknown API Error";
    const requestUrl: string = originalRequest?.url ?? '';
    const isAuthRequest = requestUrl.includes('/login');
    const isRefreshRequest = originalRequest?._isRefresh === true;

    // 401 时先尝试刷新 token（仅一次），再决定是否登出
    if (status === 401 && !isAuthRequest && !isRefreshRequest && originalRequest && !originalRequest._retry) {
      const token = getAuthToken();
      if (token) {
        originalRequest._retry = true;
        try {
          const data = await api.post<{ token: string }>('/refresh', {}, {
            headers: { Authorization: `Bearer ${token}` },
            _isRefresh: true,
          } as AxiosRequestConfig & { _isRefresh?: boolean });
          const newToken = (data as { token?: string })?.token;
          if (newToken) {
            setAuthToken(newToken);
            if (originalRequest.headers) (originalRequest.headers as Record<string, string>)['Authorization'] = `Bearer ${newToken}`;
            return api.request(originalRequest);
          }
        } catch (_) {
          // refresh 失败，下面统一 clearAuth 并跳转
        }
      }
    }

    if ((status === 401 || status === 403) && !isAuthRequest) {
      clearAuth();
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    }

    console.error('API Error:', error);
    let displayMsg = `接口错误：${errorMsg}`;
    if (typeof errorMsg === 'string' && (errorMsg.includes('CORS') || errorMsg.includes('blocked'))) {
      displayMsg = '接口错误：连接被跨域策略拦截。请使用本地后端（VITE_BACKEND_TARGET=http://127.0.0.1:3000）或让服务器允许当前来源。';
    }
    if (!isShowingError) {
      isShowingError = true;
      message.error({
        content: displayMsg,
        onClose: () => { isShowingError = false; }
      });
    }
    return Promise.reject(Object.assign(error, { msg: displayMsg }));
  }
);

export default api;
