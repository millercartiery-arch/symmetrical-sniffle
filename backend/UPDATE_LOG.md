# 更新与修复日志

## 2025-03（近期）

### 1. Redis 连接失败刷屏
- **现象**：未安装/未启动 Redis 时，后端终端大量 `[ioredis] Unhandled error event: ECONNREFUSED`。
- **修复**：`src/socket-server.ts`、`src/workers/redis.ts` 增加 `retryStrategy: () => null` 与 `lazyConnect: true`，连接失败后不再无限重试，日志不再刷屏。
- **说明**：Redis 仍可选；不启 Redis 时仅影响任务队列/锁与 Socket 实时推送，会话/聊天等接口正常。

### 2. 数据库：本地 vs 服务器 与远程调试
- **需求**：之前数据库在本地，现需确认当前连接的是本地库还是服务器库，并支持远程调试。
- **修改**：
  - **检查脚本** `scripts/check_db_and_api.ts`：根据 `DB_HOST` 显示「本地」或「服务器」；在本地运行即检查本地 DB，在服务器上运行即检查服务器 DB。
  - **健康接口**：在 `.env` 中设置 `DEBUG_DB_TARGET=true` 时，`GET /api/health` 和 `GET /health` 会返回 `dbTarget: { host, database, env }`，便于远程确认该实例连接的数据库。
  - **.env.example**：补充服务器部署时 `DB_HOST` 的说明（本地=localhost，服务器=填 IP 或域名），以及 `DEBUG_DB_TARGET` 的用法。

### 3. 会话/聊天页调试
- **.env.example**：补充 `DEBUG_PUBLIC_CHAT=true`（开发时聊天接口免 JWT）、`DEBUG_REDIS` 等说明。

---

## 使用方式摘要

| 场景 | 操作 |
|------|------|
| 检查当前环境数据库与 API | `cd backend && npx tsx scripts/check_db_and_api.ts` |
| 在服务器上确认连接的 DB（远程调试） | 服务器 `.env` 设 `DEBUG_DB_TARGET=true`，然后访问 `https://你的域名/api/health` 查看 `dbTarget` |
| 数据库改为服务器 | 在对应环境的 `.env` 中设置 `DB_HOST=服务器IP或域名`、`DB_PORT`/`DB_USER`/`DB_PASSWORD`/`DB_NAME` |
