import fs from "fs";
import path from "path";
import type { NextFunction, Request, Response } from "express";

type CounterMap = {
  total: number;
  byStatus: Record<string, number>;
};

const startedAt = Date.now();
const counters: CounterMap = {
  total: 0,
  byStatus: {},
};

/** 会话相关 API 错误/成功计数，供 Prometheus 与告警（如 5 分钟内错误率 > 5%）；code 为必填标签。 */
const conversationApiErrorsByActionAndCode: Record<string, Record<string, number>> = {};
let conversationApiSuccessTotal = 0;

export function incrementConversationError(action: string, code: string = "500"): void {
  if (!conversationApiErrorsByActionAndCode[action]) conversationApiErrorsByActionAndCode[action] = {};
  const byCode = conversationApiErrorsByActionAndCode[action];
  byCode[code] = (byCode[code] || 0) + 1;
}

export function incrementConversationSuccess(): void {
  conversationApiSuccessTotal += 1;
}

const RATE_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000);
const RATE_MAX_REQUESTS = Number(process.env.RATE_LIMIT_MAX || 120);

const rateBucket = new Map<string, { count: number; resetAt: number }>();

const auditDir = path.resolve(process.cwd(), "logs");
const auditFile = path.join(auditDir, "requests.audit.log");

const ensureAuditFile = (): void => {
  if (!fs.existsSync(auditDir)) fs.mkdirSync(auditDir, { recursive: true });
  if (!fs.existsSync(auditFile)) fs.writeFileSync(auditFile, "");
};

ensureAuditFile();

const nowIso = (): string => new Date().toISOString();

export const requestAuditMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  res.on("finish", () => {
    const durationMs = Date.now() - start;
    const tenantId = req.tenantId ?? null;
    const line = JSON.stringify({
      at: nowIso(),
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      durationMs,
      ip: req.ip,
      userId: req.userId ?? null,
      tenantId,
      ua: req.headers["user-agent"] || "",
    });
    fs.appendFile(auditFile, `${line}\n`, () => {});

    counters.total += 1;
    const key = String(res.statusCode);
    counters.byStatus[key] = (counters.byStatus[key] || 0) + 1;
  });
  next();
};

export const rateLimitMiddleware = (req: Request, res: Response, next: NextFunction) => {
  if (req.path === "/health" || req.path === "/api/health" || req.path === "/metrics") {
    return next();
  }

  const key = `${req.ip}:${req.path}`;
  const now = Date.now();
  const slot = rateBucket.get(key);

  if (!slot || now >= slot.resetAt) {
    rateBucket.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return next();
  }

  if (slot.count >= RATE_MAX_REQUESTS) {
    return res.status(429).json({
      code: 429,
      message: "Too many requests",
      retryAfterMs: Math.max(slot.resetAt - now, 0),
    });
  }

  slot.count += 1;
  return next();
};

export const metricsHandler = (_req: Request, res: Response) => {
  const uptimeSeconds = Math.floor((Date.now() - startedAt) / 1000);
  const rss = process.memoryUsage().rss;
  const heapUsed = process.memoryUsage().heapUsed;
  const heapTotal = process.memoryUsage().heapTotal;

  const lines = [
    "# HELP app_uptime_seconds Process uptime in seconds",
    "# TYPE app_uptime_seconds gauge",
    `app_uptime_seconds ${uptimeSeconds}`,
    "# HELP app_requests_total Total HTTP requests",
    "# TYPE app_requests_total counter",
    `app_requests_total ${counters.total}`,
    "# HELP app_requests_by_status_total HTTP requests by status code",
    "# TYPE app_requests_by_status_total counter",
    ...Object.entries(counters.byStatus).map(
      ([status, count]) => `app_requests_by_status_total{status="${status}"} ${count}`
    ),
    "# HELP conversation_api_errors_total Conversation/chat API errors by action and code",
    "# TYPE conversation_api_errors_total counter",
    ...Object.entries(conversationApiErrorsByActionAndCode).flatMap(([action, byCode]) =>
      Object.entries(byCode).map(
        ([code, count]) => `conversation_api_errors_total{action="${action}",code="${code}"} ${count}`
      )
    ),
    "# HELP conversation_api_success_total Conversation/chat API successes",
    "# TYPE conversation_api_success_total counter",
    `conversation_api_success_total ${conversationApiSuccessTotal}`,
    "# HELP app_memory_rss_bytes Resident set size in bytes",
    "# TYPE app_memory_rss_bytes gauge",
    `app_memory_rss_bytes ${rss}`,
    "# HELP app_memory_heap_used_bytes Heap used in bytes",
    "# TYPE app_memory_heap_used_bytes gauge",
    `app_memory_heap_used_bytes ${heapUsed}`,
    "# HELP app_memory_heap_total_bytes Heap total in bytes",
    "# TYPE app_memory_heap_total_bytes gauge",
    `app_memory_heap_total_bytes ${heapTotal}`,
  ];

  res.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
  res.status(200).send(lines.join("\n") + "\n");
};
