/**
 * 多租户中间件 - 自动从 JWT Token 中提取 tenantId
 * 所有请求都会自动关联租户，无需手动过滤
 * 
 * 使用方式：
 *   app.use(tenantMiddleware);
 *   
 * 后续在路由中可访问：
 *   req.tenantId
 *   req.userId
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

// 扩展 Express Request 以支持自定义字段
declare global {
  namespace Express {
    interface Request {
      userId?: number;
      username?: string;
      role?: string;
      tenantId?: number;
    }
  }
}

const NODE_ENV = process.env.NODE_ENV || "development";
const IS_PROD = NODE_ENV === "production";
const PUBLIC_CHAT = process.env.DEBUG_PUBLIC_CHAT === "true";

const resolveJwtSecret = (): string => {
  const secret = process.env.JWT_SECRET?.trim();
  if (secret) return secret;
  if (!IS_PROD) return "dev-only-change-me-32-char-secret";
  throw new Error("Missing required env: JWT_SECRET");
};

const JWT_SECRET = resolveJwtSecret();

/**
 * 多租户中间件
 * 1. 从 Authorization header 提取 Bearer token
 * 2. 验证 JWT 签名
 * 3. 自动注入 userId, username, role, tenantId 到 req 对象
 * 4. 后续所有路由都能访问这些字段
 */
export const tenantMiddleware = (req: Request, res: Response, next: NextFunction) => {
  // Allow the proxied frontend shell, deep links, and static assets to load
  // when the domain routes `/` through the backend service.
  if (!req.path.startsWith('/api') && (req.method === 'GET' || req.method === 'HEAD')) {
    return next();
  }

  // 跳过不需要认证的路由（含登录、健康检查、隐私同意提交）
  const publicRoutes = ['/api/login', '/api/translate', '/api/privacy/status', '/health', '/api/health', '/metrics'];
  if (PUBLIC_CHAT) {
    publicRoutes.push('/api/user/chat/messages', '/api/user/chat/conversations', '/api/user/chat/accounts');
  }
  if (publicRoutes.includes(req.path)) {
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ code: 401, message: 'Missing authorization header' });
  }

  // 提取 Bearer token
  const [type, token] = authHeader.split(' ');
  if (type?.toLowerCase() !== 'bearer' || !token) {
    return res.status(401).json({ code: 401, message: 'Invalid authorization format' });
  }

  try {
    // 验证 JWT 签名
    const decoded: any = jwt.verify(token, JWT_SECRET);

    // 自动注入到 req 对象中
    req.userId = decoded.userId;
    req.username = decoded.username;
    req.role = decoded.role;
    req.tenantId = decoded.tenantId;

    // 添加日志（可选）
    if (process.env.DEBUG_TENANT === 'true') {
      console.log(`[TenantMiddleware] User: ${decoded.username}, Tenant: ${decoded.tenantId}`);
    }

    next();
  } catch (error: any) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ code: 401, message: 'Token expired' });
    }
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ code: 401, message: 'Invalid token' });
    }
    console.error('Token verification error:', error);
    return res.status(401).json({ code: 401, message: 'Unauthorized' });
  }
};

/**
 * 辅助函数：检查租户隔离（可选）
 * 在某些需要特殊权限的路由中使用
 */
export const requireTenant = (req: Request, res: Response, next: NextFunction) => {
  if (!req.tenantId) {
    return res.status(401).json({ code: 401, message: 'Tenant not found' });
  }
  next();
};

/**
 * 辅助函数：检查特定角色
 * 使用示例：
 *   router.get('/admin', requireRole('admin'), adminController);
 */
export const requireRole = (...allowedRoles: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.role || !allowedRoles.includes(req.role)) {
      return res.status(403).json({ code: 403, message: 'Forbidden' });
    }
    next();
  };
};

/**
 * 辅助函数：为所有数据库查询自动加入 tenantId 过滤
 * 使用示例：
 *   const query = withTenantFilter('SELECT * FROM message_tasks WHERE status = ?', req.tenantId);
 *   conn.query(query, [status]);
 */
export const withTenantFilter = (query: string, tenantId?: number): string => {
  if (!tenantId) {
    console.warn('[TenantFilter] Warning: No tenantId provided, query might return cross-tenant data');
    return query;
  }

  // 检查查询是否已有 WHERE 子句
  const hasWhere = /\bWHERE\b/i.test(query);
  const tenantCondition = `tenant_id = ${tenantId}`;

  if (hasWhere) {
    // 在现有 WHERE 后追加 AND
    return query.replace(/\bWHERE\b/i, (match) => `${match} ${tenantCondition} AND`);
  } else {
    // 添加新的 WHERE 子句
    return query.replace(/;?\s*$/, ` WHERE ${tenantCondition}`);
  }
};

/**
 * 辅助函数：确保查询包含 tenantId 过滤
 * 在开发环境下可用于捕获遗漏的租户隔离
 */
export const validateTenantFilter = (query: string, tenantId?: number): void => {
  if (!tenantId) {
    return;
  }

  // 只在 SELECT 和 UPDATE/DELETE 中检查
  if (/^\s*(SELECT|UPDATE|DELETE)\b/i.test(query)) {
    // 检查是否包含 tenant_id 条件
    if (!/tenant_id\s*=\s*\?/i.test(query) && !/tenant_id\s*=\s*\d+/i.test(query)) {
      console.warn('[TenantFilter] ⚠️ WARNING: Query may not include tenant isolation:', query);
      if (process.env.STRICT_TENANT_CHECK === 'true') {
        throw new Error(`Query missing tenant_id filter: ${query}`);
      }
    }
  }
};

export default tenantMiddleware;
