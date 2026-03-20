import "dotenv/config";
import express from "express";
import http from "http";
import cors from "cors";
import helmet, { type HelmetOptions } from "helmet";
import accountRouter from "./routes/account.js";
import cardCredentialRouter from "./routes/card-credential.js";
import authRouter from "./routes/auth.js";
import campaignRouter from "./routes/campaign.js";
import miscRouter from "./routes/misc.js";
import dashboardRouter from "./routes/dashboard.js";
import chatRouter from "./routes/chat.js";
import inboundRouter from "./routes/inbound.js";
import proxyRouter from "./routes/proxy.js";
import protocolRouter from "./routes/protocol.js";
import gatewayRouter from "./routes/gateway.js";
import webControllerRouter from "./routes/web-controller.js";
import v1Router from "./routes/v1.js";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { initSocket } from "./socket-server.js";
import { tenantMiddleware } from "./middleware/tenant.js";
import { metricsHandler, rateLimitMiddleware, requestAuditMiddleware } from "./middleware/ops.js";
import { errorHandler } from "./middleware/errorHandler.js";

const app = express();
const server = http.createServer(app);
const PORT = Number(process.env.PORT || 3000);
const NODE_ENV = process.env.NODE_ENV || "development";

// 反向代理（Nginx 等）后正确识别协议与 Host，用于 CORS 同域放行与静态资源
app.set("trust proxy", 1);

const parseAllowedOrigins = (): string[] => {
  const rawValues = [process.env.CORS_ORIGINS || "", process.env.ALLOWED_ORIGINS || ""];
  const tauriOrigins = ["https://tauri.localhost", "tauri://localhost"];
  const localhostOrigins = [
    "http://localhost:8080",
    "http://localhost:3000",
    "http://127.0.0.1:8080",
    "http://127.0.0.1:3000",
  ];
  const productionDomain = ["https://hkd.llc", "http://hkd.llc", "https://www.hkd.llc", "http://www.hkd.llc"];
  const parsed = rawValues
    .flatMap((raw) => raw.split(","))
    .map((v) => v.trim())
    .filter(Boolean);

  return Array.from(new Set([...parsed, ...tauriOrigins, ...localhostOrigins, ...productionDomain]));
};

const allowedOrigins = parseAllowedOrigins();

// Initialize Socket.io
initSocket(server);

const serverPublicOrigin = process.env.SERVER_PUBLIC_ORIGIN?.trim(); // 可选：同机前端地址，如 https://hkd.llc
// 使用 cors options delegate（拿到 req），避免并发请求下的全局状态竞态导致误判/500
app.use(
  cors((req, cb) => {
    const corsOptions: cors.CorsOptions = {
      credentials: true,
      origin(origin, callback) {
        // same-origin 请求（如直接访问 /api/health）通常没有 Origin
        if (!origin) return callback(null, true);
        if (NODE_ENV !== "production") return callback(null, true);
        if (allowedOrigins.includes(origin)) return callback(null, true);
        if (serverPublicOrigin && origin === serverPublicOrigin) return callback(null, true);
        if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) return callback(null, true);

        // 域名挂载：与当前请求同域则放行（前端与 API 同域名或同 Nginx 反代时无需再配 CORS_ORIGINS）
        const proto = (req.get("x-forwarded-proto") || (req as any).protocol || "https").split(",")[0].trim();
        const host = (req.get("host") || "").split(",")[0].trim();
        const sameOrigin = host ? `${proto}://${host}` : "";
        if (sameOrigin && origin === sameOrigin) return callback(null, true);

        // 不抛错（避免变成 500/HTML 影响静态资源加载），直接拒绝该 origin
        return callback(null, false);
      },
    };

    cb(null, corsOptions);
  })
);

const helmetOptions: HelmetOptions =
  NODE_ENV === "production"
    ? {
        contentSecurityPolicy: {
          useDefaults: true,
          directives: {
            defaultSrc: ["'self'"],
            baseUri: ["'self'"],
            frameAncestors: ["'self'"],
            formAction: ["'self'"],
            objectSrc: ["'none'"],
            scriptSrc: ["'self'"],
            scriptSrcAttr: ["'none'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            styleSrcAttr: ["'unsafe-inline'"],
            fontSrc: ["'self'", "data:", "https://fonts.gstatic.com"],
            imgSrc: ["'self'", "data:", "blob:", "https:"],
            connectSrc: ["'self'", "ws:", "wss:"],
            workerSrc: ["'self'", "blob:"],
            manifestSrc: ["'self'"],
            mediaSrc: ["'self'", "data:", "blob:"],
          },
        },
      }
    : { contentSecurityPolicy: false };

app.use(helmet(helmetOptions));
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(rateLimitMiddleware);
app.use(requestAuditMiddleware);

// ✅ 添加多租户中间件 - 自动关联 tenantId
app.use(tenantMiddleware);

app.get("/health", (_req, res) => {
  const payload: Record<string, unknown> = { ok: true, service: "massmail-api" };
  if (process.env.DEBUG_DB_TARGET === "true") {
    const host = process.env.DB_HOST || "localhost";
    payload.dbTarget = { host, database: process.env.DB_NAME || "massmail", env: process.env.NODE_ENV || "development" };
  }
  res.json(payload);
});
app.get("/api/health", (_req, res) => {
  const payload: Record<string, unknown> = { ok: true, service: "massmail-api" };
  if (process.env.DEBUG_DB_TARGET === "true") {
    const host = process.env.DB_HOST || "localhost";
    payload.dbTarget = { host, database: process.env.DB_NAME || "massmail", env: process.env.NODE_ENV || "development" };
  }
  res.json(payload);
});
app.get("/metrics", metricsHandler);

// Keep legacy flat paths used by frontend/import tool.
app.use("/api", authRouter);
app.use("/api", cardCredentialRouter);
app.use("/api", accountRouter);
app.use("/api", campaignRouter);
app.use("/api", miscRouter);
app.use("/api", dashboardRouter);
app.use("/api", chatRouter);
app.use("/api", inboundRouter);
app.use("/api", proxyRouter);
app.use("/api", protocolRouter);
app.use("/api", gatewayRouter);
app.use("/api", webControllerRouter);
app.use("/api/v1", v1Router);

// Serve static files for downloads (updates)
const DOWNLOADS_DIR = path.resolve(process.cwd(), "downloads");
if (!fs.existsSync(DOWNLOADS_DIR)) {
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}
app.use("/downloads", express.static(DOWNLOADS_DIR));

// 先挂载前端静态资源，确保 /assets/* 返回 JS/CSS 而非 index.html（避免 MIME 错误白屏）
const envFrontendDir = process.env.FRONTEND_DIR?.trim();
const possibleFrontendDirs = [
  path.resolve(process.cwd(), "../frontend/dist"),
  path.resolve(process.cwd(), "frontend/dist"),
  path.resolve(process.cwd(), "../.vercel/output/static/frontend"),
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "frontend", "dist"),
].filter((p) => p && !p.includes("undefined"));
// 若设置了 FRONTEND_DIR 则强制使用该路径（避免 PM2 下 existsSync 因权限/cwd 误报）
let FRONTEND_DIR: string;
if (envFrontendDir) {
  FRONTEND_DIR = path.resolve(envFrontendDir);
  console.log("[massmail-api] serving frontend from FRONTEND_DIR env:", FRONTEND_DIR);
} else {
  FRONTEND_DIR = possibleFrontendDirs.find((d) => fs.existsSync(d)) || possibleFrontendDirs[0];
  if (!fs.existsSync(FRONTEND_DIR)) {
    console.warn("[massmail-api] FRONTEND_DIR not found, tried:", possibleFrontendDirs.join(", "));
  } else {
    console.log("[massmail-api] serving frontend from", FRONTEND_DIR);
  }
}
app.use("/assets", express.static(path.join(FRONTEND_DIR, "assets")));
app.use(express.static(FRONTEND_DIR));

app.use("/", webControllerRouter);

app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api")) return next();
  const indexPath = path.join(FRONTEND_DIR, "index.html");
  if (!fs.existsSync(indexPath)) {
    res.status(404).send("index.html not found. Check FRONTEND_DIR.");
    return;
  }
  res.sendFile(indexPath);
});
app.use(errorHandler);

const HOST = process.env.HOST || "0.0.0.0"; // 0.0.0.0 便于远程/局域网调试
server.listen(PORT, HOST, () => {
  console.log(`[massmail-api] listening on ${HOST}:${PORT}`);
});
