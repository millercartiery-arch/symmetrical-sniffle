import { useEffect, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { Spin } from "antd";
import { apiUrl } from "../api";
import { getAuthToken, getUserInfo, clearAuth, USER_INFO_KEY } from "../utils/jwt-auth";
import { type CanonicalRole, normalizeAppRole } from "../utils/access-control";

interface ProtectedRouteProps {
  allowedRoles?: CanonicalRole[];
  children?: React.ReactNode;
}

type VerifiedUser = {
  id?: number;
  username?: string;
  role: CanonicalRole;
  tenantId?: number;
};

const VERIFY_TIMEOUT_MS = 25000; // 与 api 超时一致，避免弱网下验证未完成就超时

const fetchWithTimeout = (url: string, options: RequestInit, ms: number): Promise<Response> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ms);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timeoutId));
};

const verifyRoleFromToken = async (token: string): Promise<VerifiedUser | null> => {
  try {
    const res = await fetchWithTimeout(
      apiUrl("/me"),
      { headers: { Authorization: `Bearer ${token}` } },
      VERIFY_TIMEOUT_MS
    );
    if (!res.ok) return null;
    const data = await res.json();
    const payload = data?.data ?? data?.user ?? {};
    const role = normalizeAppRole(payload?.role);
    if (!role) return null;
    return {
      id: payload?.userId ?? payload?.id,
      username: payload?.username,
      role,
      tenantId: payload?.tenantId,
    };
  } catch (err) {
    console.error("Token verification failed:", err);
    return null;
  }
};

const ProtectedRoute = ({ allowedRoles, children }: ProtectedRouteProps) => {
  const location = useLocation();
  const [status, setStatus] = useState<"checking" | "ok" | "fail">("checking");
  const [role, setRole] = useState<CanonicalRole | null>(null);

  useEffect(() => {
    let cancelled = false;
    // 使用统一的 jwt-auth 工具获取信息
    const token = getAuthToken();
    const cachedUser = getUserInfo();

    if (!token) {
      setStatus("fail");
      return;
    }

    if (cachedUser) {
      const cachedRole = normalizeAppRole(cachedUser.role);
      if (cachedRole && !cancelled) {
        setRole(cachedRole);
      }
    }

    verifyRoleFromToken(token)
      .then((verifiedUser) => {
        if (cancelled) return;
        if (!verifiedUser) {
          throw new Error("role verify failed");
        }
        
        // 用 /me 的返回值回写缓存，避免本地只剩 role 没有用户信息。
        const nextUser = {
          ...(cachedUser || {}),
          id: verifiedUser.id ?? cachedUser?.id,
          username: verifiedUser.username ?? cachedUser?.username,
          tenantId: verifiedUser.tenantId ?? cachedUser?.tenantId,
          role: verifiedUser.role,
        };
        localStorage.setItem(USER_INFO_KEY, JSON.stringify(nextUser));
        
        setRole(verifiedUser.role);
        setStatus("ok");
      })
      .catch(() => {
        if (cancelled) return;
        clearAuth();
        setStatus("fail");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (status === "checking") {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 280 }}>
        <Spin size="large" tip="验证登录状态…" />
      </div>
    );
  }

  if (status === "fail") {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (allowedRoles?.length && !role) {
    clearAuth();
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (allowedRoles?.length && role && !allowedRoles.includes(role)) {
    // Fallback to login if the account lacks required role.
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return children ? <>{children}</> : <Outlet />;
};

export default ProtectedRoute;
