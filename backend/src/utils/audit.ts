/**
 * 统一 API 错误审计：将 GET /conversations/:id 等异常写入 audit_logs，便于排查与监控。
 * 使用现有 audit_logs 表：action = 'api_error'，details = JSON。
 */
import { pool } from "../shared/db.js";

export interface ApiErrorAuditParams {
  action: string;
  targetId?: number | null;
  targetRef?: string | null;
  operatorId?: number | null;
  userId?: string | null;
  tenantId?: number | null;
  err: Error;
}

/**
 * 记录 API 错误到 audit_logs（action=api_error, details 含 error_msg、stack、target 等）
 */
export async function logApiError(params: ApiErrorAuditParams): Promise<void> {
  const { action, targetId, targetRef, operatorId, userId, tenantId, err } = params;
  const details = JSON.stringify({
    target_id: targetId ?? null,
    target_ref: targetRef ?? null,
    operator_id: operatorId ?? null,
    error_msg: err?.message ?? String(err),
    stack: err?.stack ?? null,
  });
  try {
    const conn = await pool.getConnection();
    try {
      await conn.execute(
        `INSERT INTO audit_logs (user_id, action, details, tenant_id) VALUES (?, ?, ?, ?)`,
        [
          userId ?? (operatorId != null ? String(operatorId) : null),
          `api_error:${action}`,
          details,
          tenantId ?? 1,
        ]
      );
    } finally {
      conn.release();
    }
  } catch (e) {
    console.error("[audit] logApiError failed:", e);
  }
}
