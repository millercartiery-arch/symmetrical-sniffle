// JWT 和 Token 管理工具

export const JWT_TOKEN_KEY = 'jwt_token';
export const USER_INFO_KEY = 'user_info';
const PRIVACY_POPUP_SHOWN_KEY = 'privacyPopupShown';

/**
 * 存储 JWT token 和用户信息
 */
export const setAuthToken = (token: string, userInfo?: { id: number; username: string; role: string; tenantId: number }) => {
  localStorage.setItem(JWT_TOKEN_KEY, token);
  if (userInfo) {
    localStorage.setItem(USER_INFO_KEY, JSON.stringify(userInfo));
  }
};

/**
 * 获取存储的 JWT token
 */
export const getAuthToken = (): string | null => {
  return localStorage.getItem(JWT_TOKEN_KEY);
};

/**
 * 获取用户信息
 */
export const getUserInfo = () => {
  const stored = localStorage.getItem(USER_INFO_KEY);
  if (!stored) return null;
  try {
    return JSON.parse(stored);
  } catch {
    return null;
  }
};

/**
 * 清除认证信息
 */
export const clearAuth = () => {
  localStorage.removeItem(JWT_TOKEN_KEY);
  localStorage.removeItem(USER_INFO_KEY);
};

/**
 * 检查是否已认证
 */
export const isAuthenticated = (): boolean => {
  return !!getAuthToken();
};

/**
 * 获取当前用户角色（来自 user_info 或 JWT payload）
 */
export const getUserRole = (): string | null => {
  const userInfo = getUserInfo();
  if (userInfo?.role) return userInfo.role;
  const token = getAuthToken();
  if (!token) return null;
  const payload = parseJwtPayload(token);
  return (payload?.role as string) ?? null;
};

/**
 * 检查隐私弹窗是否已显示
 */
export const hasPrivacyPopupShown = (): boolean => {
  const stored = localStorage.getItem(PRIVACY_POPUP_SHOWN_KEY);
  if (!stored) return false;

  try {
    const { expiry } = JSON.parse(stored);
    const now = Date.now();

    // 如果已过期，清除记录并返回false
    if (now > expiry) {
      localStorage.removeItem(PRIVACY_POPUP_SHOWN_KEY);
      return false;
    }

    return true;
  } catch {
    // 解析失败时清除记录
    localStorage.removeItem(PRIVACY_POPUP_SHOWN_KEY);
    return false;
  }
};

/**
 * 标记隐私弹窗已显示（30天有效期）
 */
export const markPrivacyPopupShown = () => {
  const now = Date.now();
  const expiry = now + (30 * 24 * 60 * 60 * 1000); // 30天后过期

  localStorage.setItem(PRIVACY_POPUP_SHOWN_KEY, JSON.stringify({
    timestamp: now,
    expiry: expiry
  }));
};

/**
 * 清除隐私弹窗记录（用于测试）
 */
export const clearPrivacyPopupShown = () => {
  localStorage.removeItem(PRIVACY_POPUP_SHOWN_KEY);
};

/**
 * 从 JWT token 中解析信息（不验证签名）
 * 仅用于客户端显示，服务器会验证签名
 */
export const parseJwtPayload = (token: string) => {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    
    const payload = JSON.parse(
      atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))
    );
    return payload;
  } catch {
    return null;
  }
};

/**
 * 检查 token 是否已过期
 */
export const isTokenExpired = (token: string): boolean => {
  const payload = parseJwtPayload(token);
  if (!payload || !payload.exp) return true;
  
  // exp 是秒级时间戳，需要乘以 1000 转为毫秒
  return Date.now() >= payload.exp * 1000;
};
