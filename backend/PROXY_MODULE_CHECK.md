# 代理功能模块 — 数据库与 API 检查说明

## 一、数据库连接与表结构

### 1. 连接与池

- **统一连接池**：`backend/src/shared/db.ts` 导出 `pool`（mysql2/promise），被以下模块使用：
  - `routes/proxy.ts`（所有代理相关 API）
  - `workers/scheduler.ts`（调度器解析代理并入队）
  - `workers/worker.ts`（使用队列中的 `proxyUrl`，不直连代理表）
  - `routes/web-controller.ts`（另一处 system/proxies/status）
- **使用方式**：各路由/worker 均 `getConnection()`，在 `finally` 中 `conn.release()`，无泄漏。

### 2. 表依赖关系

- **proxies**：独立表，由 `ensureProxySchema(conn)` 创建/迁移，不依赖其他业务表。
- **account_proxy_bindings**：依赖 `accounts` 与 `proxies`，外键为：
  - `account_id` → `accounts(id) ON DELETE CASCADE`
  - `proxy_id` → `proxies(id) ON DELETE CASCADE`
- **注意**：若数据库中尚未存在 `accounts` 表，首次执行 `ensureProxySchema` 创建 bindings 表时会报错（Failed to open the referenced table 'accounts'）。需先通过主应用或其他迁移创建 `accounts`，再访问代理相关 API 或运行调度器。

### 3. 本地验证脚本

```bash
cd backend
npx tsx scripts/check_proxy_db.ts
```

- 会加载 `.env`、取池连接、执行 `ensureProxySchema` 并查询 `proxies` / `account_proxy_bindings` 行数。
- 若报错 `Failed to open the referenced table 'accounts'`：请先启动一次主 API 或执行建表/迁移，确保存在 `accounts` 后重试。

---

## 二、API 挂载与调用链

### 1. 路由挂载

- 在 `backend/src/index.ts` 中：`app.use("/api", proxyRouter);`
- 因此所有代理相关接口前缀为 **`/api`**。

### 2. 代理相关接口一览

| 方法 | 路径 | 说明 | 数据库使用 |
|------|------|------|-------------|
| 任意 | /api/* | 先经 proxy 路由的 `router.use` 中间件 | 调用 `ensureProxySchema(conn)`，保证表存在 |
| GET | /api/proxies | 列表所有代理 | 查询 `proxies` |
| POST | /api/proxies | 批量新增代理 | 插入 `proxies`，并可选同步 dispatchEngine |
| DELETE | /api/proxies/:id | 删除一条代理 | 删除 `proxies` |
| GET | /api/system/proxies/status | 代理存活/归属地/延迟（探测） | 查 `proxies` + bindings 数量，探测后写回 `proxies` |
| GET | /api/proxies/bindings | 账号-代理绑定列表 | 查 `account_proxy_bindings` JOIN `proxies` |
| POST | /api/proxies/bind | 创建/更新一条绑定 | 写 `account_proxy_bindings`（事务） |
| POST | /api/proxies/:id/check | 单条代理连通性检查 | 查 `proxies`，请求后更新状态 |

### 3. 调度与 Worker 调用链

- **Scheduler**（`workers/scheduler.ts`）：
  - 每轮 `dispatchPending()` 使用同一 `conn`，先 `ensureSchedulerSchema(conn)`（内部调 `ensureProxySchema(conn)`）。
  - 为每个待执行任务调用 `resolveProxyUrlForAccount(conn, accountId)`：
    - 查询 `account_proxy_bindings` JOIN `proxies`，取主绑定并生成带 Session 的 proxy URL；
    - 若无绑定则回退到 `accounts.proxy_url`（若有）；若仍无则返回空并跳过该任务。
  - 仅当 `proxyUrl` 非空时才入队；入队 payload 含 `proxyUrl`。
- **Worker**（`workers/worker.ts`）：
  - 仅使用 job 中的 `proxyUrl`，不再查库或使用 `accounts.proxy_url`，保证与调度端一致。

---

## 三、快速自测（API 是否正常调动）

1. **启动后端**（需已配置 `.env` 中的 DB、Redis）：
   ```bash
   cd backend
   npm run start
   # 或 npm run start:prod
   ```
2. **健康检查**：
   ```bash
   curl -s http://localhost:3000/api/health
   ```
3. **代理列表**（应返回 `code:0` 和 `data` 数组，可为空）：
   ```bash
   curl -s http://localhost:3000/api/proxies
   ```
4. **代理状态**（会做探测，可能较慢；返回 total/alive/dead/items 等）：
   ```bash
   curl -s http://localhost:3000/api/system/proxies/status
   ```
5. **绑定列表**（需已有 `account_proxy_bindings` 表；若无 `accounts` 会先在前述接口报错）：
   ```bash
   curl -s http://localhost:3000/api/proxies/bindings
   ```

若 2 正常而 3 报 500，多为数据库连接或缺少 `accounts` 表导致 schema 未就绪，按第一节处理后再试。
