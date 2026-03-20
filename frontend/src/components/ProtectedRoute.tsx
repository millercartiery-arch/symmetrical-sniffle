import { useEffect, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { Spin } from "antd";
import { apiUrl } from "../api";
import { getAuthToken, getUserInfo, clearAuth, USER_INFO_KEY } from "../utils/jwt-auth";

type AppRole = "admin" | "operator";

interface ProtectedRouteProps {
  allowedRoles?: AppRole[];
  children?: React.ReactNode;
}

const normalizeRole = (raw: unknown): AppRole | null => {
  const role = String(raw || "").toLowerCase();
  if (role === "admin" || role === "super_admin" || role === "tenant_admin") return "admin";
  if (role === "operator" || role === "member") return "operator";
  return null;
};

const VERIFY_TIMEOUT_MS = 25000; // 与 api 超时一致，避免弱网下验证未完成就超时

const fetchWithTimeout = (url: string, options: RequestInit, ms: number): Promise<Response> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ms);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timeoutId));
};

const verifyRoleFromToken = async (token: string): Promise<AppRole | null> => {
  try {
    const res = await fetchWithTimeout(
      apiUrl("/me"),
      { headers: { Authorization: `Bearer ${token}` } },
      VERIFY_TIMEOUT_MS
    );
    if (!res.ok) return null;
    const data = await res.json();
    const role = normalizeRole(data?.data?.role ?? data?.user?.role);
    return role ?? null;
  } catch (err) {
    console.error("Token verification failed:", err);
    return null;
  }
};

const ProtectedRoute = ({ allowedRoles, children }: ProtectedRouteProps) => {
  const location = useLocation();
  const [status, setStatus] = useState<"checking" | "ok" | "fail">("checking");
  const [role, setRole] = useState<AppRole | null>(null);

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
      const cachedRole = normalizeRole(cachedUser.role);
      if (cachedRole && !cancelled) {
        setRole(cachedRole);
      }
    }

    verifyRoleFromToken(token)
      .then((verifiedRole) => {
        if (cancelled) return;
        if (!verifiedRole) {
          throw new Error("role verify failed");
        }
        
        // 更新缓存中的角色信息
        const nextUser = {
          ...(cachedUser || {}),
          role: verifiedRole
        };
        localStorage.setItem(USER_INFO_KEY, JSON.stringify(nextUser));
        
        setRole(verifiedRole);
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
