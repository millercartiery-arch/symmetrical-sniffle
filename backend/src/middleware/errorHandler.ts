/**
 * 全局错误处理：计数 + 审计 + 统一返回，防止错误被 swallow。
 * 应在所有路由注册之后、静态/fallback 之后挂载。
 */
import type { Request, Response, NextFunction } from "express";
import { logApiError } from "../utils/audit.js";
import { incrementConversationError } from "./ops.js";

function deriveAction(req: Request, err: any): string {
  if (err?.action && typeof err.action === "string") return err.action;
  const path = (req.originalUrl || req.url || "").split("?")[0];
  if (path.includes("/user/chat/messages")) return "detail";
  if (path.includes("/user/chat/send")) return "send";
  if (path.includes("/user/chat/conversations") && !path.includes("/pin") && !path.includes("/ban") && !path.includes("/delete") && !path.includes("/read")) return "list";
  if (path.includes("/user/chat/accounts")) return "accounts";
  return "unknown";
}

export async function errorHandler(err: any, req: Request, res: Response, _next: NextFunction): Promise<void> {
  console.error("[Global Error Handler]:", err);
  const code = err?.status?.toString() ?? err?.response?.status?.toString() ?? "500";
  const action = deriveAction(req, err);

  // 1️⃣ 计数（同步，永不漏记；code 为必填标签）
  incrementConversationError(action, code);

  // 2️⃣ 审计（写入失败也不影响返回）
  try {
    const targetRef = (req.query?.peerPhone ?? req.body?.peerPhone ?? req.originalUrl ?? req.url) as string | undefined;
    await logApiError({
      action,
      targetRef: targetRef ?? undefined,
      userId: (req as any).userId ?? null,
      tenantId: Number((req as any).tenantId ?? 1),
      err: err instanceof Error ? err : new Error(String(err?.message ?? err)) as Error,
    });
  } catch (e) {
    console.error("🚨 audit log write failed in errorHandler →", e);
  }

  // 3️⃣ 统一返回（与 api.ts 拦截器配合：error / message 均会显示为「接口错误：xxx」）
  const safeMsg = err?.message ?? "未知错误";
  const status = Math.min(599, Math.max(400, parseInt(code, 10) || 500));
  if (!res.headersSent) {
    res.status(status).json({
      error: safeMsg,
      message: safeMsg,
    });
  }
}
