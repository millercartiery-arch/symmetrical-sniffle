# 故障排查对照表

## 数据库字段与代码对齐说明

- **主 schema**：以 `scripts/schema_full_create.sql` 为准；参考 `scripts/schema_full_reference.sql`（注释版）。
- **message_tasks**：已废弃字段 `error_message`、`processed_at`、`completed_at`，代码仅使用 `error_msg`、`updated_at`；若库中仍有旧列可执行 `scripts/migrate_drop_message_tasks_redundant_columns.sql`。
- **audit_logs**：写入时需包含 `tenant_id`（默认 1），与主 schema 一致。
- **tasks 表**：仅当执行过 `init_status_system.sql` 时存在；主业务使用 `message_tasks` / campaigns，遗留的 TaskService 与 task 路由已移除。
- **proxy_audit**：`proxy_id` 必须与 `proxies.id` 类型一致（均为 **BIGINT UNSIGNED**）。若库中仍为 INT 或类型不一致，执行 `scripts/migrate_proxy_audit_fk.sql` 统一为 BIGINT UNSIGNED；部署/建库后可用 `SHOW CREATE TABLE proxy_audit\G` 确认 `proxy_id` 为 `BIGINT UNSIGNED NULL`。

### proxy_audit 外键检查清单（staging/生产部署前）

建议在 **staging** 跑一遍，通过后再在生产执行迁移（生产执行前务必备份）。

| 检查点 | 操作 | 期望 |
|--------|------|------|
| ① 两列类型对齐 | `SHOW CREATE TABLE proxies\G` 与 `SHOW CREATE TABLE proxy_audit\G` | `proxies.id` 为 `BIGINT UNSIGNED NOT NULL AUTO_INCREMENT`，`proxy_audit.proxy_id` 为 `BIGINT UNSIGNED NULL` |
| ② 外键存在且规则正确 | `SELECT UPDATE_RULE, DELETE_RULE FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_NAME='fk_proxy_audit_proxy';` | `UPDATE_RULE='CASCADE'`，`DELETE_RULE='SET NULL'` |
| ③ 无其它表引用 proxy_audit | `SELECT TABLE_NAME, CONSTRAINT_NAME FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE WHERE REFERENCED_TABLE_NAME='proxy_audit' AND REFERENCED_COLUMN_NAME='proxy_id';` | 返回 **0 行** |
| ④ 迁移脚本幂等 | 在测试库执行两次 `mysql massmail < backend/scripts/migrate_proxy_audit_fk.sql` | 第二次执行不报错，外键仍存在 |

---

## Ⅰ 点进去不显示（会话详情为空）

本项目的会话模型：**列表**用 `GET /api/user/chat/conversations`（按 tenant 返回 phone 列表），**详情**用 `GET /api/user/chat/messages?peerPhone=xxx`（按号码+租户拉消息）。点击列表项会设置 `peerPhone` 并触发 `loadMessages(peerPhone)`，即会请求详情接口。

| # | 根因 | 本项目对应 | 检查点 |
|---|------|------------|--------|
| 1️⃣ | 前端只渲染列表、未请求详情 | ✅ 已做：点击会话会请求 `GET /user/chat/messages?peerPhone=xxx` | Network 中点击一条记录后应有 `/api/user/chat/messages?peerPhone=...` |
| 2️⃣ | 后端返回空 | 同一 JWT 下 list 与 messages 都用 `tenant_id`，若 list 有该 phone 则 messages 应有数据 | 后端日志看 SQL；DB 执行 `SELECT * FROM message_tasks WHERE target_phone=? AND tenant_id=?` |
| 3️⃣ | LIMIT 限死 | 列表 LIMIT 50–500；消息 LIMIT 50（默认）且单次最多 500，按 **号码** 查，不按 id 分页 | 无需按 conversation id 分页 |
| 4️⃣ | 权限过滤 | 所有 chat 接口用 `req.tenantId`（JWT），list 与 detail 一致 | 确认请求头带同一 Authorization；后端 `tenant_id` 一致 |
| 5️⃣ | 软删/状态异常 | `message_tasks` 未按 status 过滤（Pending/Sent/Received 都查）；`contacts.deleted` 仅影响列表展示 | 查 `message_tasks` 该 phone 的 status、tenant_id |
| 6️⃣ | 前端传参类型错误 | 前端传 `peerPhone` 字符串，后端要求非空字符串；400 时前端会提示「参数错误」 | Network 看 URL 中 `peerPhone` 是否为正确号码字符串 |

---

## Ⅱ 大批量报错的常见根因

| 报错类型 | 可能原因 | 本项目中对应位置 | 排查方式 |
|----------|----------|------------------|----------|
| **A. Rate limit exceeded** | 子账号 rate 已满 | `sub_accounts.rate_counter` / `rate_limit`（见 `worker.ts`、`card-credential-schema.ts`） | `SELECT id, rate_counter, rate_limit FROM sub_accounts WHERE status='ready';` |
| **B. Login failed** | 凭证失效、卡密失效 | `credentials`、`card_keys` 表 | `SELECT * FROM credentials WHERE id=?;`、`SELECT * FROM card_keys WHERE id=?;` |
| **C. Proxy error / ECONNREFUSED** | 代理不可达、认证错误 | `proxy_audit`、`proxies` 表 | 查 `proxy_audit` 最近 `action='test'` 及 `error_msg`；核对代理 IP、端口、auth |
| **D. Invalid phone number** | 号码格式/黑名单 | 当前无 `blacklisted_numbers` 表；号码校验在发送逻辑中 | 查 `message_tasks.target_phone` 格式与长度 |
| **E. DB 死锁 / 超时** | InnoDB lock wait | 多 worker 写 `sub_accounts`（如 `is_busy`） | `SHOW ENGINE INNODB STATUS;` 看锁等待；确保 is_busy 及时释放 |
| **F. Missing token / 401** | 请求未带 JWT | `tenantMiddleware` 要求除白名单外均需 Authorization | Network 看 Response 401；后端日志 "Missing authorization"；开发可开 `DEBUG_PUBLIC_CHAT=true` 免鉴权 chat |

---

## 连接服务器调试解决报错

前端连**服务器上的 API** 时，按下面步骤配置并排查，可快速定位连接/报错原因。

### 1. 前端指向服务器 API

在 **frontend** 目录下用环境变量指定后端地址（构建时注入）：

- **VITE_API_BASE_URL**：请求 API 的 baseURL（axios），例如 `https://你的域名/api`（末尾不要多写 `/api` 两次）。
- **VITE_API_URL**：Tauri / Socket 等用到的根地址，例如 `https://你的域名`。

**示例**（`frontend/.env.production` 或 `.env.development`）：

```bash
# 连接服务器时改为实际地址
VITE_API_BASE_URL=https://your-server.com/api
VITE_API_URL=https://your-server.com
VITE_SOCKET_BASE_URL=https://your-server.com
```

改完后需**重新构建**：`cd frontend && npm run build`，再部署或刷新页面。

### 2. 在服务器上查看日志、指标、脚本

| 操作 | 命令 / 方式 |
|------|-------------|
| 看 API 错误日志 | `ssh user@服务器` → `pm2 logs api`（或主进程名，如 `pm2 logs massmail-api`） |
| 看 Worker 日志 | `pm2 logs worker-1` |
| 健康检查 | `curl -s https://your-server.com/api/health` 或 `curl -s https://your-server.com/health` |
| Prometheus 指标 | `curl -s https://your-server.com/metrics \| grep conversation_api_` |
| 端到端排查脚本（对服务器 API） | 在**本机** backend 目录：`.env` 里设 `API_BASE_URL=https://your-server.com/api`、`ADMIN_TOKEN=你的JWT`，然后 `node scripts/debug-conversation.js 20 1` |

### 3. 常见连接/报错与处理

| 现象 | 可能原因 | 处理 |
|------|----------|------|
| **ERR_CONNECTION_REFUSED / 无法连接** | 服务器未启动、端口未开放、防火墙 | 在服务器上 `pm2 list`、`curl -v http://127.0.0.1:3000/health`；开放对应端口或 Nginx 反向代理 |
| **应用无法打开 / 白屏 / 一直加载** | 前端静态未找到、Nginx 未把 `/` 代理到后端、静态 404 | 1) 服务器上 `pm2 logs massmail-api` 看是否有 `serving frontend from ...` 或 `FRONTEND_DIR not found`；2) 确认部署后存在 `frontend/dist` 且与 backend 同级（`/var/www/massmail/frontend/dist`）；3) 若用 Nginx，根路径 `/` 与 `/assets` 需反向代理到后端同一端口（或后端直接对外提供静态）；4) 浏览器 F12 → Network 看 `/`、`/assets/*` 是否 200。 |
| **CORS 错误** | 服务器未允许前端域名 | 后端 `cors` 或 `CORS_ORIGINS`/`ALLOWED_ORIGINS` 中加入前端域名（或临时 `*` 仅调试） |
| **401 Unauthorized** | 未带 token 或 token 过期 | 前端确认请求头带 `Authorization: Bearer <JWT>`；重新登录拿新 token；脚本里设 `ADMIN_TOKEN` |
| **混合内容 (Mixed Content)** | 页面是 HTTPS，请求了 HTTP API | 将 **VITE_API_BASE_URL** 改为 `https://...`，或服务器侧提供 HTTPS |
| **接口 500** | 后端异常 | 在服务器上按上文看 `pm2 logs`、`/metrics`、`audit_logs`，结合本文档 Ⅱ / 3️⃣ 根因表排查 |
| **接口错误: timeout of 10000ms exceeded** | 请求超时：后端慢、网络延迟、或域名/代理未指向 API | 1) 前端已将超时改为 25s，弱网下可减少误报；2) 确认访问域名与 `VITE_API_BASE_URL` 一致（若用 `www.hkd.llc` 访问，后端 CORS 需放行该 origin，且 API 需能从该页同源或跨域可达）；3) 服务器上 `curl -w '%{time_total}' https://hkd.llc/api/health` 看接口响应时间。 |

### 4. 快速自检清单

- [ ] 前端 `.env.*` 中 **VITE_API_BASE_URL** 指向的地址在浏览器可访问（同源或 CORS 已配）。
- [ ] 服务器上 API 进程在跑（`pm2 list`），且 `curl` 本机 `http://127.0.0.1:PORT/health` 返回 200。
- [ ] 已用**有效 JWT** 登录（或脚本里设 **ADMIN_TOKEN**），请求带 `Authorization`。
- [ ] 若用 Nginx：已配置 `proxy_pass` 到后端端口，并如需放行 WebSocket（Socket 连接）。

按上述配置并逐项检查后，再结合 TROUBLESHOOTING 中的 **2️⃣ 排查清单**、**3️⃣ 常见根因对照表** 进一步定位业务报错。

---

## 4️⃣ 大批量报错的根因处理（业务层）

| 报错 | 处理思路 | 本项目对应 |
|------|----------|------------|
| **Rate limit exceeded** | 提高子账号 `rate_limit`（`UPDATE sub_accounts SET rate_limit=1000 WHERE id=?;`），或增加子账号数量（多建几条 `sub_accounts`），或调高 `rotation_interval`，使同一子账号请求间隔更大。 | `sub_accounts.rate_limit`（默认 300）、`rate_counter` / `rate_reset_at`；见 `worker.ts`、`card-credential-schema.ts`。子账号列表/更新见 `card-credential` 相关 API。 |
| **Login failed** | 更新 `credentials.password_hash`（bcrypt），或重新激活卡密（`card_keys.status='unused'`），然后重新调用激活 API。 | `credentials`、`card_keys` 表；激活流程见 `backend/src/routes/card-credential.ts`。 |
| **Proxy error** | 重新运行 `node scripts/proxy-check.mjs`，把 `last_error_msg` 记录下来；将错误率高的代理禁用：`PATCH /api/proxies/:id` 传 `{ "enabled": false }`（对应 DB 字段 `proxies.is_active=0`）。 | 脚本：`backend/scripts/proxy-check.mjs`；代理列表/禁用：`backend/src/routes/proxy.ts`（PATCH 支持 `enabled`）。 |
| **Invalid phone** | 在 `message_tasks` 插入前统一做**手机号标准化**（去空格、括号等），或在 UI 用正则校验，如 `(\+\?\d{1,3})\s?\(?\d{3}\)?[-\s]?\d{3}[-\s]?\d{4}`。 | 后端：`chat.ts` 在写入前对 `peerPhone` 做标准化（仅保留数字）；前端：`Chat.tsx` 已用 `normalizePhoneForApi()` 传参，可再加输入框正则校验。 |
| **DB 死锁** | 给 `sub_accounts.is_busy` 加 Redis 锁（已有），事务内使用 `SELECT … FOR UPDATE SKIP LOCKED`。若仍冲突，可加**悲观锁 + 超时释放**：定时任务执行 `UPDATE sub_accounts SET is_busy=0, locked_at=NULL WHERE locked_at < NOW() - INTERVAL 2 MINUTE;`。 | `workers/scheduler.ts` 已有 `releaseStaleLocks()`：按间隔释放 `message_tasks`、`accounts`、`sub_accounts` 的过期锁（`locked_at < NOW() - INTERVAL ? MINUTE`）。 |
| **401 / token 失效** | 重新登录获取 JWT；或检查 `pm2 logs` 是否有 `TokenExpiredError`，确认 auth 中间件是否正确读取 `Authorization`。 | 前端 401/403 会清除登录并跳转登录页；后端 `tenantMiddleware` 校验 JWT，白名单见 `middleware/tenant.ts`。 |

---

## Ⅲ 具体排查与修复步骤

建议在 Staging 先跑通再上 Production；**修改前务必备份数据库（mysqldump）**。

### 本项目后端 API 位置

- **列表**：`src/routes/chat.ts` → `GET /user/chat/conversations`（返回 phone、last_message、sent_count、received_count、account_status 等，带 `LIMIT` 用于分页，仅影响列表条数）
- **详情（消息列表）**：`src/routes/chat.ts` → `GET /user/chat/messages?peerPhone=xxx`（按 **号码 + tenant_id** 查该会话的全部消息，带 `LIMIT` 1–500 防止单次拉取过多，**不是**按 conversation id 查一条）

本项目**没有** `GET /api/conversations/:id`，详情是「某号码下的所有消息」，因此不会出现「列表 LIMIT 20 导致详情 id 超出 20 查不到」的问题。

### 1️⃣1️⃣ 常见错误与修复对照

| 错误 | 修复方式 | 本项目现状 |
|------|----------|------------|
| 详情接口误用 LIMIT 导致只返回前 N 条 | 详情接口不应再套用列表的 LIMIT | ✅ 消息接口用独立 `limit` 参数（默认 50，最大 500），仅限制**该号码**的消息条数，不依赖列表分页 |
| 权限过滤（WHERE tenant_id）导致空 | 列表与详情使用同一 `tenant_id` | ✅ 两接口均用 `(req as any).tenantId`，来自同一 JWT |
| 查询字段缺失（如无 content、error_msg） | SELECT 显式包含 content、status、error_msg | ✅ 已返回 id、peer_phone、direction、content、media_url、status、**error_msg**、created_at |
| 软删导致列表有、详情无 | 列表与详情 WHERE 条件一致（如 deleted=0） | ✅ `message_tasks` 未按 deleted 过滤；若以后加软删，需在列表与消息查询中**同时**加相同条件 |

### 建议自检清单

1. 打开 `backend/src/routes/chat.ts`，确认：
   - `GET /user/chat/messages` 的 WHERE 仅有 `target_phone = ? AND tenant_id = ?`，无多余条件导致误过滤。
   - 列表 `GET /user/chat/conversations` 的 tenant_id 与消息接口来源一致（均来自 `req.tenantId`）。
2. 在 Staging 用同一账号：先拉列表，再点一条会话，看 Network 是否请求 `GET /user/chat/messages?peerPhone=...` 且返回 200 与 `data` 数组。
3. 若仍空：在 DB 执行 `SELECT * FROM message_tasks WHERE target_phone = ? AND tenant_id = ?`（替换为实际 phone、tenant_id），确认是否有行。

### 2️⃣ 前端点击加载细节（对应 `src/pages/Chat.tsx`）

本项目无 `ConversationList.tsx`，会话列表与详情在 **Chat.tsx**：点击列表项设置 `peerPhone`，由 `useEffect` 调用 `loadMessages(peerPhone)`，请求 `GET /user/chat/messages?peerPhone=xxx`（无 conversation id）。

| 改进 | 说明 | 本项目现状 |
|------|------|------------|
| **Loading 状态** | loadDetail 前 setLoading(true)，完成后 setLoading(false) | ✅ loadMessages 内已有，非 silent 时 setLoading(true/false) |
| **错误提示** | 捕获 404/401/500 并 message.error，不静默 | ✅ 已区分 400 / 401·403 / 其他，并 setMessages([]) |
| **分页/滚动** | 列表超过 100 条可考虑无限滚动，避免一次拉太多超时 | 列表 LIMIT 50–500；消息单会话 limit 200，可按需加「加载更多」 |
| **缓存** | 已打开会话缓存，再次点击直接读缓存 | ✅ 使用 messagesCacheRef (Map<phone, ChatMessage[]>) 先展示缓存再静默刷新 |
| **手机号格式化** | +1(999)999-0001 → 纯数字传 API，后端 LIKE 可搜 | ✅ normalizePhoneForApi()：去非数字，请求 messages/send 与搜索均用该值；展示仍用 formatPhoneNumber() |

---

## 3️⃣ 统一错误日志与监控

### 错误审计（后端）

- **位置**：`backend/src/utils/audit.ts` → `logApiError(action, targetId?, targetRef?, operatorId?, userId?, tenantId?, err)`  
- **存储**：使用现有 `audit_logs` 表，`action = 'api_error:detail' | 'api_error:list' | 'api_error:send' | 'api_error:accounts'`，`details` 为 JSON（含 `error_msg`、`stack`、`target_ref` 等）。  
- **触发**：`GET /user/chat/messages`（detail）、`GET /user/chat/conversations`（list）、`POST /user/chat/send`（send）、`GET /user/chat/accounts`（accounts）在 **catch** 中会调用 `logApiError` 并增加 Prometheus 错误计数。

### 前端统一错误提示

- **位置**：`frontend/src/api.ts` → axios 响应拦截器。  
- **行为**：所有接口错误统一展示为「接口错误：${msg}」，401/403 仍会清除登录并跳转登录页。

### Prometheus 指标（`GET /metrics`）

| 指标 | 类型 | 说明 |
|------|------|------|
| `conversation_api_errors_total{action="detail"}` | counter | 会话详情（messages）接口异常次数 |
| `conversation_api_errors_total{action="list"}` | counter | 会话列表接口异常次数 |
| `conversation_api_errors_total{action="send"}` | counter | 发送消息接口异常次数 |
| `conversation_api_errors_total{action="accounts"}` | counter | 账号列表接口异常次数 |
| `conversation_api_success_total` | counter | 上述接口成功次数 |

### 告警建议（5 分钟内错误率 > 5% → Slack/邮件）

在 **Prometheus + Alertmanager** 中配置，不在应用代码内实现。示例思路：

1. **Prometheus 规则**（例：`prometheus_rules.yml`）  
   - 使用 `rate(conversation_api_errors_total[5m])` 与 `rate(conversation_api_success_total[5m])` 计算 5 分钟错误率。  
   - 条件：`(errors / (errors + success)) > 0.05` 时触发 alert（如 `ConversationApiHighErrorRate`）。  
2. **Alertmanager**：将上述 alert 路由到 Slack、邮件等（receiver、route、inhibit 按需配置）。

应用端仅负责暴露 `/metrics` 与上述 counter；告警规则与通知渠道由运维在 Prometheus/Alertmanager 中配置。

### 1️⃣ 先确认「统一错误日志」真的在运行

| 检查点 | 操作 | 期望 |
|--------|------|------|
| **audit_logs 表（migration 是否已执行）** | `npm run db:migrate`<br>（本项目无 `db:migrate:status`，直接执行 migrate 会确保表存在） | 表结构含：`id`, `user_id`, `action`, `details`, `created_at`, `tenant_id`（本项目用 `details` 存 JSON，内含 target_ref、error_msg、stack 等） |
| **logApiError 被调用** | 在 `chat.ts` 的 catch 中已加 `console.log('⚡ logApiError', { action, errMsg })`；**redeploy 后**触发一次会话接口 5xx（如故意制造错误） | 终端或 `pm2 logs <api 进程名>` 能看到 `⚡ logApiError` 的打印 |
| **audit_logs 写入成功** | 在 DB 客户端执行：<br>`SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 5;` | 至少出现 `action = 'api_error:detail'` 或 `api_error:send` 等记录，`details` 为 JSON |
| **Prometheus 指标暴露** | 浏览器访问 `http://<host>:<port>/metrics`，搜索 `conversation_api_errors_total` | 有 `conversation_api_errors_total{action="detail",code="500"}` 等行（本项目已支持 action + code 标签） |
| **前端拦截器** | Chrome DevTools → Network → 任选一失败请求 → 看 response 或前端弹出的错误文案 | 文案以 **接口错误：** 开头，而非原始后端错误裸奔 |

若任一步未通过，说明对应改动未生效。常见原因：**PM2 未重启**（旧进程仍在跑旧代码）、**.env 未同步**（如 ADMIN_TOKEN、DB_*）、或前端未重新构建部署。

### 2️⃣ 「错误状态显示为已修复」的根因与对策

| 类别 | 典型表现 | 可能根因 | 解决思路 |
|------|----------|----------|----------|
| **A. 审计记录未写入** | UI 报错列表里只有「已修复」，但后端 audit_logs 为空 | • `audit.ts` 未被引入<br>• `logApiError` 抛错后被外层 catch 吞掉<br>• 主业务事务回滚导致 INSERT 被撤销 | 1. 确认 `import { logApiError } from '../utils/audit.js';` 在路由文件顶部存在。<br>2. 把 `logApiError` 放在 catch 最外层；若担心二次异常遮蔽，可 `logApiError(...).catch(e => console.error('[audit]', e))` 不 await。<br>3. 本项目 `logApiError` 已用 **独立 connection**（`pool.getConnection()` + 单条 INSERT），不参与业务事务，主业务回滚不会撤销审计；内部 catch 仅 `console.error`，不向外抛。 |
| **B. 前端状态缓存/渲染不更新** | 刷新后仍显示「已修复」，但 Network 里 status 已是新错误 | • useSWR/React Query 的 staleTime 导致结果被缓存<br>• 错误列表未把 `error` → `status` 映射更新 | 1. 错误列表若用 useSWR：`useSWR('/admin/audit', { refreshInterval: 5000 })`；若用 React Query：设 `refetchInterval`。<br>2. 确保 `api.ts` 拦截器在错误分支 **return Promise.reject(error)**，不要 return 普通对象（否则 SWR/React Query 会当成成功响应）。 |
| **C. 业务路径仍走旧分支** | 如 `/user/chat/send` 的异常是 400 而非 5xx，未走 logApiError | • try/catch 只包了部分代码，其他 await 在外层未捕获<br>• 旧路由仍被注册（如 `app.use('/chat', oldRouter)` 与现用 router 重复） | 1. 确认 **仅有一处** 挂载 chat 路由：`index.ts` 里 `app.use('/api', ...)` 只引用当前 `chatRouter` 一次。<br>2. 可选：用统一包装避免漏捕 —— `const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);`，路由写 `router.get('/messages', asyncHandler(getMessages));`，再在**全局 errorHandler** 里根据 path/status 调用 `logApiError`。 |
| **D. DB 数据不统一导致查询不到** | 「详情为空」：GET /user/chat/messages?peerPhone=xxx 返回空数组 | • 历史数据带 `+`/空格，新写入已用 `normalizePhone` 纯数字；用 `peerPhone='123456789'` 查不到 `+1 234 567 89` | 1. **历史数据迁移**：一次性把 `message_tasks.target_phone`、`contacts.phone` 统一为仅数字。MySQL 8.0 可用：<br>`UPDATE message_tasks SET target_phone = REGEXP_REPLACE(target_phone, '[^0-9]', '');`<br>`UPDATE contacts SET phone = REGEXP_REPLACE(phone, '[^0-9]', '');`<br>（更早版本可用应用层脚本逐行读再写回。）<br>2. 查询处已用 **normalizePhone(peerPhone)** 再 WHERE，确保请求参数与库内格式一致。 |
| **E. Prometheus 告警阈值未生效** | 仪表盘错误在涨，但「错误率 > 5%」告警不触发 | • 告警规则用了不存在的标签（如 `code`），而当前只按 `action` 打点 | 1. 当前实现：`conversation_api_errors_total` 仅有 **action** 标签（无 code）。若告警规则里写了 `code="500"` 等，需改成按 `action` 或去掉 code。<br>2. 若需**按状态码告警**：在 `ops.ts` 中为错误计数增加 **code** 维度（如 `conversationApiErrorsByActionAndCode[action][code]`），在 `incrementConversationError(action, code)` 和 `/metrics` 输出时带上 `code` 标签；catch 中传入 `res.statusCode` 或 500。 |

最常见的「已修复」误报往往是 **A（审计没写） + C（旧路由未下线）**：UI 依赖审计表判断状态，而审计表根本没有数据。

---

## 现象抽象与完整排查方案

### 1️⃣ 先把现象抽象出来

| UI 上报的症状 | 你现在看到的文字 | 含义 |
|---------------|------------------|------|
| 会话列表/详情里所有对话均报错 | “Failed to fetch messages”、“会话加载失败: Request failed with status code 500” | 后端返回 5xx，前端把错误直接渲染出来（可能未被统一「接口错误」拦截器改写） |
| 同一手机号（如 +1 (520) 270‑0394）被标离线仍尝试拉历史 | 列表显示该号，点进去报错或空 | 可能是**手机号标准化**不一致、DB 查不到对应记录，或**外部代理/卡密失效**导致内部调用抛异常 |
| 多次连续报错（点 × 关掉又出现） | 每次点会话都 500 | 前端自动重试仍失败，后端持续 500；错误计数应在 Prometheus 中累加 |

**核心疑问**：到底是 **① 后端代码没走到 logApiError**，还是 **② 走了但写入审计失败**，还是 **③ 前端根本没有使用最新的错误拦截器**？

---

### 完整排查方案（一步步锁定根因）

按下面顺序做，可确定是 ① / ② / ③ 中的哪一种（或组合）。

| 步骤 | 操作 | 结论判断 |
|------|------|----------|
| **S1** | 打开 Chrome DevTools → **Network**，点一条会话触发详情请求，看 **Response** 里 body 的文案 | 若文案**不是**以「接口错误：」开头 → 多半是 **③ 前端未用最新拦截器**（未部署新前端或用了别的 axios 实例）。若**是**「接口错误：xxx」→ 拦截器已生效，继续 S2。 |
| **S2** | 看该请求的 **Status code**（如 500） | 确认是 5xx 后，到后端查日志。 |
| **S3** | 在后端机器执行 `pm2 logs <api 进程名> --lines 100`（或看终端），搜索 **⚡ logApiError** | 若**没有**对应时间的 `⚡ logApiError` → **① 后端没走到 logApiError**（路由未挂载新代码、或 catch 未覆盖到该异常、或旧进程未重启）。若有 → 继续 S4。 |
| **S4** | 在 DB 执行：`SELECT * FROM audit_logs WHERE action LIKE 'api_error:%' ORDER BY created_at DESC LIMIT 5;` | 若**没有**刚发生的 `api_error:detail` / `api_error:list` 等 → **② 审计写入失败**（表不存在、权限、连接池满、logApiError 内部抛错被吞等）。若有 → 审计与计数都正常，问题在业务/环境（如 DB 查不到、代理挂）。 |
| **S5** | 访问 `http://<host>:<port>/metrics`，搜索 **conversation_api_errors_total** | 若在触发几次 500 后该计数器**没涨** → 与 S3 一致，**① 没走到** incrementConversationError（同上：旧代码或漏捕）。若**涨了** → 至少计数逻辑已执行，再结合 S4 区分 ①/②。 |

**小结**：

- **S1 失败** → 先修前端：确保生产/Staging 用的是带「接口错误：」拦截器的构建，且会话请求走的是该 api 实例。
- **S3 无 ⚡ logApiError** → 先修后端：确认 `chat.ts` 的 catch 里调用了 `logApiError` 且已 redeploy、pm2 重启；必要时用 asyncHandler + 全局 errorHandler 兜底。
- **S3 有、S4 无** → 修审计写入：检查 `audit_logs` 表存在、账号有 INSERT 权限；在 `logApiError` 内 try/catch 只 `console.error` 不 rethrow，避免二次异常遮蔽原错误。
- **S4 有、仍报 500** → 根因在业务/环境：手机号标准化 + 历史数据迁移（见 2️⃣-D）、代理/卡密（见 4️⃣ / Ⅶ）。

---

### 2️⃣ 排查清单（一步步执行，记录每一步输出）

先在本机开**三个终端**（或用 tmux）：

1. **pm2 logs api**（或 `pm2 logs worker-1`）——看后端错误日志  
2. **curl http://localhost:3000/metrics | grep conversation_api_**——看监控计数  
3. **git rev-parse HEAD**——确认当前代码版本  

按下面顺序执行，**任一步异常就先停，把日志/输出贴到 Issue 或记录**。

---

#### 2.1 ✅ 确认审计表已迁移

```bash
# 本项目无 db:migrate:status，直接执行 migrate 确保表存在
npm run db:migrate
```

若表不存在，`logApiError` 里的 INSERT 会抛错（如 `Table 'audit_logs' doesn't exist`），导致 500 且看不到 ⚡ logApiError 的日志（请求在进 catch 前就崩或审计写入抛错）。

---

#### 2.2 ✅ 确认后端代码已包含 logApiError、normalizePhone、计数逻辑

```bash
git rev-parse HEAD   # 贴出 commit hash

# 确认关键代码存在
grep -n "logApiError" backend/src/routes/chat.ts
grep -n "normalizePhone" backend/src/routes/chat.ts
grep -n "incrementConversationError\|conversationApiErrors" backend/src/middleware/ops.ts
```

若 grep 找不到，说明当前跑的是旧部署（常见原因：PM2 未重启或仍指向旧 `dist/`）。

**处理**：

```bash
cd backend
npm ci && npm run build
pm2 reload all   # 或 pm2 restart <进程名>
```

---

#### 2.3 ✅ 检查前端构建是否包含最新错误拦截器

- 打开 DevTools → **Network** → 任选一次 **/user/chat/messages** 失败请求  
- 右键 → Copy → **Response**，看返回体  

**期望**：接口错误时前端展示的文案为 **「接口错误：&lt;具体错误&gt;」**（来自 `api.ts` 拦截器）。  

**实际**：若是纯 HTML、或后端原始错误堆栈直接出现在 UI，说明请求没走 `frontend/src/api.ts` 的拦截器。

**前端未更新常见原因**：只做了 `npm install` 没做 `npm run build`；PM2/Nginx 仍指向旧的 `build/` 或 `dist/`。

**强制重建**：

```bash
cd frontend
npm ci
npm run build
# 若用 pm2 代理静态资源
pm2 reload web   # 按实际进程名改
```

---

#### 2.4 ✅ 看后端日志：是否出现 logApiError 条目

在 **pm2 logs api**（或对应进程）里搜 **⚡ logApiError**，例如：

```
⚡ logApiError { action: 'detail', errMsg: '...' }
```

- **有** → 错误已被捕获，审计应已写入，继续 2.5 查表。  
- **无** → 可能路由没进 catch、或 catch 里把错误吞了（没 `next(err)`）、或仍在跑旧路由（确认 `index.ts` 里只挂载了当前 chatRouter，且无重复 `/send` 等）。

---

#### 2.5 ✅ 检查 audit_logs 表最新错误记录

本项目 `audit_logs` 结构为 **user_id, action, details, created_at, tenant_id**（无单独 target_ref/payload 列，target_ref/error_msg 在 **details** JSON 里）。

```sql
SELECT id, action, user_id, details, created_at
FROM audit_logs
WHERE action LIKE 'api_error:%'
ORDER BY created_at DESC
LIMIT 10;
```

- **有记录** → 审计写入成功，可根据 `details` 里的 message/stack 定位根因（如 DB 死锁、代理超时等）。  
- **无记录** → 审计未写入，回到 2.4 看是否真有 ⚡ logApiError，并检查表结构/权限。

---

#### 2.6 ✅ 运行端到端排查脚本（debug-conversation.js）

```bash
cd backend
# 参数：limit=20，取第 1 条（index 从 1 开始，不是 0）
node scripts/debug-conversation.js 20 1
```

脚本输出三块：

1. **GET /user/chat/conversations** 返回的列表及选中的 **peerPhone**（应为纯数字，如 1520270394）。  
2. **DB 查询**：`SELECT ... FROM message_tasks WHERE target_phone = ? AND tenant_id = ? ORDER BY created_at DESC LIMIT 5`（本项目用 `?` 占位）。  
3. **GET /user/chat/messages?peerPhone=xxx** 的 HTTP 状态、响应体、WHERE 条件。

**典型情况**：

- 第 2 步 **0 条** → 历史数据没有该 phone 的 message_tasks，后续业务可能 null 引用 → 500；需做历史数据迁移（见上文 2️⃣-D）。  
- 第 3 步 **500 且响应体无统一 msg** → 异常可能在业务外（如 DB 死锁、代理 ECONNREFUSED），在日志里搜 **deadlock**、**ECONNREFUSED**。

---

#### 2.7 ✅ 看 Prometheus 指标是否在涨

```bash
curl http://localhost:3000/metrics | grep conversation_api_
```

**期望**（本项目已支持 **action** + **code** 标签，便于按状态码告警）：

```
conversation_api_errors_total{action="detail",code="500"} 12
conversation_api_success_total 83
```

- **错误计数不涨** → 可能没走到 `incrementConversationError`（与 2.4 无 ⚡ logApiError 一致）。  
- **错误计数在涨** → 监控已打点，若前端仍无「接口错误：」提示，说明前端拦截器未生效（回到 2.3）。

---

### 3️⃣ 常见根因对照表（对应 Ⅳ 排查脚本与 audit_logs 输出）

根据现象与 audit_logs 的 **details**（本项目为 JSON，内含 error_msg、stack 等）、或 debug-conversation.js 的输出，可快速对照下表定位并修复。

| 观察到的现象 | 可能根因 | 代码/DB/配置 检查点 | 快速 Fix |
|--------------|----------|----------------------|----------|
| **500 + details 中 error_msg 含 ECONNREFUSED / proxy** | 代理/卡密失效，外部服务不可达 | **proxy_audit** 最近 5 条 `action='test'` 的 detail 是否报错；DB 表 **proxies** 的 host/port/auth；.env 中代理相关是否有效 | 更换/重新获取卡密；跑 `node scripts/proxy-check.mjs`；禁用异常代理：`PATCH /api/proxies/:id` 传 `{ enabled: false }` |
| **500 + details 中 error_msg 含 ER_LOCK_DEADLOCK** | DB 死锁（大量并发写同一 contact 等） | MySQL：`SHOW ENGINE INNODB STATUS;` 或 `information_schema.INNODB_TRX` 看锁等待；长事务与锁持有者 | 业务层加重试（如 `retry(() => db.query(...), 3)`）；或 INSERT 改为 INSERT … ON DUPLICATE KEY UPDATE（UPSERT）减少冲突 |
| **500 + 返回体或 details 中 code/status 为 401** | Token / tenant 错误 | 请求头 **Authorization** 是否为有效 JWT；**tenant_id** 与 JWT 是否一致 | 重新登录或脚本生成新 JWT；确认 `Authorization: Bearer <token>`、租户与 audit_logs 一致 |
| **500 + error_msg 含 invalid_phone / 格式不合法** | 手机号未被 normalizePhone 处理 | 前端 **normalizePhoneForApi** 是否在请求前调用；后端 **normalizePhone** 是否对 **GET /user/chat/messages**、**POST /user/chat/send** 的 peerPhone 均生效（列表 GET /user/chat/conversations 返回的 phone 来自 DB，写入时需统一） | UI 输入加正则校验（如 `^[0-9]{7,15}$`）；后端所有入口对 peerPhone 统一调用 normalizePhone；历史数据跑 `npm run migrate:normalize-phone` |
| **未写入 audit_logs** | 迁移未执行 / 表结构不匹配 | MySQL：`SHOW COLUMNS FROM audit_logs;` 确认有 **user_id, action, details, created_at, tenant_id**（本项目无 payload 列，details 存 JSON） | 执行 `npm run db:migrate`；必要时按 schema 手动建表或补列 |
| **前端仍显示 “会话加载失败: Request failed with status code 500”** | 前端拦截器未生效 | 打开前端构建产物（如 `frontend/dist/assets/*.js`）搜索 **接口错误**，若无则未含最新 api.ts | `cd frontend && npm run build`，重新部署静态资源并 `pm2 reload web`（或刷新 CDN） |
| **所有请求返回 500，错误计数不涨** | 异常未进入自定义 errorHandler（路由未用 asyncHandler 或未 next(err)） | 检查 **chat.ts** 各 handler：是否用 **asyncHandler** 包裹，或 catch 内是否 **next(err)**；**index.ts** 是否在所有路由之后挂载 **errorHandler** | 将路由改为 `router.get('/...', asyncHandler(handler));`，在 **errorHandler** 中统一 logApiError + incrementConversationError + `res.status(code).json({ error, message })` |

---

### 代码/部署 改进建议

1. **后端**：保证 **logApiError 永不被 swallow**——在 `logApiError` 内先**同步**执行计数器（`incrementConversationError`），再在 **try/catch** 里写 `audit_logs`；catch 里只 `console.error`，不 rethrow，这样审计失败也不会吞掉原始错误；路由里 `await logApiError(...)` 后 **next(err)** 交给全局 errorHandler 统一返回 5xx 与文案。
2. **前端**：所有会话相关请求走**同一** axios 实例（带「接口错误：」的 response 拦截器）；确认生产构建包含最新 `api.ts`，部署后强刷验证。
3. **部署**：每次改 `chat.ts` / `audit.ts` / `ops.ts` 或前端 `api.ts` 后，**重启 API 进程**（如 pm2 restart）并**重新构建并部署前端**，避免旧进程/旧静态资源导致「现象在而改动能未生效」。

---

### 4️⃣ 快速代码/部署补丁（参考上述根因）

补丁已接入：**全局 errorHandler**（计数 + 审计 + 统一返回）、**asyncHandler** 包装（防止遗漏 try/catch）。在对应分支且代码最新时，执行 `npm run build && pm2 reload all` 即可。

**4.1 强化全局错误处理（已实现）**

- **位置**：`backend/src/middleware/errorHandler.ts`  
- **行为**：从请求 path 推导 `action`（detail/send/list/accounts），调用 `incrementConversationError(action)` 与 `logApiError(...)`，审计失败仅 `console.error` 不 rethrow，最后 `res.status(code).json({ error, message })`。  
- **挂载**：在 `index.ts` 中于**所有路由之后**挂载 `app.use(errorHandler)`（已替换原全局 catch）。

**4.2 统一路由包装（已用于 GET /user/chat/messages）**

- **位置**：`backend/src/utils/asyncHandler.ts`  
- **用法**：`router.get('/user/chat/messages', asyncHandler(async (req, res) => { ... }));`，路由内无需 catch，未捕获异常会进入 `next(err)` → errorHandler。  
- **注意**：使用 `asyncHandler` 的路由需在 **finally** 中释放资源（如 `conn.release()`），避免泄漏。

**4.3 确保所有入口都使用 normalizePhone**

- **位置**：`backend/src/routes/chat.ts`，已 **export** `normalizePhone(raw)`（仅保留数字，去除 +、空格、()、-）。  
- **必须**在 **GET /user/chat/messages**（query.peerPhone）、**POST /user/chat/send**（body.peerPhone）以及任何以 phone 做查询/写入的入口**前**调用。  
- 本项目 **GET /user/chat/conversations** 为列表接口，不接收 peerPhone 过滤；若日后增加按 phone 过滤，也需对入参做 normalizePhone。

**4.4 前端统一错误拦截（确保「接口错误」文案出现）**

- **位置**：`frontend/src/api.ts`。  
- 响应拦截器已统一展示「接口错误：${errorMsg}」，并 **Promise.reject(Object.assign(error, { msg: displayMsg }))**，便于组件 `.catch(err => err.msg)` 直接展示，不再出现裸的 “Request failed with status code 500”。  
- 重新打包部署后，所有 api.get/post 的 .catch 可拿到 **error.msg**。

**4.5 迁移 / 初始化 audit_logs（若表缺失）**

- 本项目**不使用 knex**，使用 **npm run db:migrate**（即 db:ensure / schema 脚本）。  
- **audit_logs** 表结构为：**id, user_id, action, details, created_at, tenant_id**（无 target_ref、payload、resolved_at 列；details 存 JSON）。  
- 若表不存在：执行 `npm run db:migrate`，或按 `scripts/schema_full_create.sql` 中 `CREATE TABLE audit_logs ...` 手动建表。

**4.6 前端 UI 防止 Invalid Phone 直接触发请求**

- **位置**：`frontend/src/pages/Chat.tsx`。  
- 已增加 **PHONE_REGEX = /^[0-9]{7,15}$/**，在 **sendOutbound** 中发送前校验：若 `!PHONE_REGEX.test(peer)` 则 `message.warning('手机号格式不合法，请仅输入 7~15 位数字')` 并 return，不发起请求。

---

### 5️⃣ 完整排查后最可能的场景 & 对应处理方案

| 场景 | 你检查的步骤 | 结果 | 需要做的事 |
|------|--------------|------|------------|
| **审计表缺失** | 2.1 Migration | audit_logs 表不存在 | `npm run db:migrate`（或按 schema 手动建表） |
| **代码未重新部署** | 2.2 代码版本、PM2 重启 | git rev-parse 与期望不符 | `npm run build && pm2 reload all` |
| **前端未重新编译** | 2.3 前端拦截器 | 构建产物中无「接口错误」文案 | `cd frontend && npm run build`，重新部署静态资源 / pm2 reload web |
| **错误未写入审计** | 2.4 / 2.5 logApiError 未出现 | pm2 logs 无 ⚡ logApiError | 确认路由用 asyncHandler 或 catch 内 next(err)；errorHandler 已在 index 注册 |
| **DB 中找不到目标手机号** | 2.6 脚本第 2 步返回 0 条 | message_tasks/contacts 无对应记录 | 跑 `npm run migrate:normalize-phone`，或手动插入示例：`INSERT INTO contacts (phone, ...) VALUES ('1520270394', ...);` |
| **代理失效/卡密过期** | 2.6 脚本返回 ECONNREFUSED | proxy_audit 最近 5 条均 failed | 更换卡密、更新 proxies 表或 .env、跑 proxy-check.mjs、重启 worker |
| **DB deadlock** | 2.6 或 details 中 error_msg 含 ER_LOCK_DEADLOCK | 频繁写同一 target_phone | 写入处加 ON DUPLICATE KEY UPDATE 或重试（如 `retry(() => db.query(...), 3)`） |
| **500 且审计已写入** | 2.5 有记录，details 里是业务错误 | 业务空指针、非法参数 | 看 details.message/stack，定位到具体函数，加防御性检查（如 `if (!contact) throw new Error('Contact not found')`） |

---

#### 6️⃣ 实际演示（假设已跑完 2️⃣–5️⃣）

**1️⃣ 确认 audit_logs 已有记录**

本项目 **audit_logs** 无 `target_ref`、`payload` 列，相关信息在 **details**（JSON）中。可先查最近 detail 错误：

```sql
-- MySQL：details 为 JSON，内含 target_ref、error_msg 等
SELECT id, action, user_id, details, created_at
FROM audit_logs
WHERE action = 'api_error:detail'
ORDER BY created_at DESC
LIMIT 5;
```

若需按号码筛（target_ref 在 details 里）：

```sql
SELECT id, action, JSON_UNQUOTE(JSON_EXTRACT(details, '$.target_ref')) AS target_ref,
       JSON_UNQUOTE(JSON_EXTRACT(details, '$.error_msg')) AS error_msg, created_at
FROM audit_logs
WHERE action = 'api_error:detail'
  AND JSON_UNQUOTE(JSON_EXTRACT(details, '$.target_ref')) = '1520270394'
ORDER BY created_at DESC
LIMIT 5;
```

示例：若 **error_msg** 为 `ECONNREFUSED`，多为代理/卡密失效。

**处理（代理失效时）**

- 查最近代理审计：`SELECT * FROM proxy_audit ORDER BY id DESC LIMIT 5;`（本项目无 target 列，按 proxy_id 看对应代理）。  
- 若失败率高：更换卡密、跑 `node scripts/proxy-check.mjs`，或禁用该代理：`PATCH /api/proxies/:id` 传 `{ enabled: false }`。  
- 若使用环境变量代理：在 .env 中调整或置空后重启。  
- 重启 worker：`pm2 restart worker-1`。

---

#### 7️⃣ 结束检查 & 交付

| 维度 | 检查项 | 预期 |
|------|--------|------|
| **前端** | 刷新页面，打开会话/消息列表 | 消息列表正常渲染，不再弹出 “Request failed with status code 500”；错误以「接口错误：xxx」展示 |
| **后端** | `pm2 logs api`（或主进程名） | 无未捕获异常堆栈；错误已进 errorHandler 或路由 catch |
| **审计** | `SELECT COUNT(*) FROM audit_logs WHERE action LIKE 'api_error:%';` | 若业务已恢复，新错误会减少；若仍为 0 且无 500，说明请求未再触发错误路径 |
| **监控** | Prometheus：`conversation_api_errors_total`、`conversation_api_success_total` | 错误率 &lt; 5%（与告警阈值一致）；`conversation_api_errors_total{action="detail",code="500"}` 趋于稳定或下降 |
| **文档** | 本次排查过程、根因、解决方案 | 写入 **TROUBLESHOOTING.md**：对应 **Ⅶ 常见错误快速定位小表** 与 **Ⅴ 防止同类问题再次出现（运营规范）**，便于下次同类问题快速定位 |

---

### 6️⃣ 让前端渲染实时刷新

若会话/消息列表依赖接口数据，可开启定时刷新，避免「已修复」状态滞后：

```tsx
// frontend/src/pages/Chat.tsx（示例）
import useSWR from 'swr';
import api from '../api';

// 5 秒自动刷新，审计/状态变化能尽快看到
const { data, error, mutate } = useSWR(
  () => (peerPhone ? `/user/chat/messages?peerPhone=${peerPhone}` : null),
  (url) => api.get(url),
  { refreshInterval: 5000, dedupingInterval: 0 }
);

const handleRefresh = () => mutate();
```

若仍出现「已修复」的 UI：检查列表/详情是否从 **audit_logs**（或等价接口）再次读取状态；若存在缓存，可改为 `useSWR('/admin/audit?...', ..., { revalidateOnFocus: true })` 并保证接口返回最新 `status`。

---

### 7️⃣ 完整排查 Checklist（可粘到 Issue 或本地核对）

- [ ] **1️⃣** db:migrate 已完成 → audit_logs 表存在  
- [ ] **2️⃣** pm2 已重新部署 → 所有 node 进程版本一致（git rev-parse HEAD）  
- [ ] **3️⃣** ADMIN_TOKEN、TENANT_ID 正确 → 能成功访问会话/审计相关接口  
- [ ] **4️⃣** 前端已编译部署 → `npm run build` 且 pm2 reload 或静态资源已更新  
- [ ] **5️⃣** 旧路由已清理 → `grep -R "router.post('/send'"` 等仅剩预期引用  
- [ ] **6️⃣** normalizePhone 在写入/查询处统一使用  
- [ ] **7️⃣** Prometheus `/metrics` 能看到 conversation_api_errors_total  
- [ ] **8️⃣** Alertmanager 规则使用的标签与当前指标一致（本项目已有 action、code 标签）  
- [ ] **9️⃣** 前端 SWR/React Query 的 refreshInterval 或 revalidateOnFocus 已配置（> 0）  
- [ ] **🔟** 已运行 debug-conversation.js，确认「空消息」是否因历史数据未标准化  

完成以上检查后，错误列表的状态应能正确反映「未修复」（audit_logs 有 api_error:* 且无 resolved_at）或「已恢复」。

---

### 8️⃣ 下一步建议（防止同类问题反复）

| 建议 | 说明 | 本项目现状 |
|------|------|------------|
| **审计写入事务外** | 业务事务回滚时仍保留错误记录 | ✅ 已在 `logApiError` 中实现：独立 connection，不参与业务事务 |
| **统一错误码标签** | Prometheus 中 `code` 作为必填标签，便于按状态码告警 | ✅ 已在 `ops.ts` 中实现：`incrementConversationError(action, code)`，默认 `code="500"`；`/metrics` 输出 `conversation_api_errors_total{action="...",code="..."}`；errorHandler 与 chat 的 catch 均传入 code |
| **自动 Phone Normalization Migration** | 部署脚本中增加一步，历史数据统一为仅数字 | ✅ 已提供 `npm run migrate:normalize-phone`（`scripts/migrate-normalize-phone.js`，需 MySQL 8.0+ 的 REGEXP_REPLACE）；部署时可加一步 `npm run migrate:normalize-phone` |
| **CI 检查** | GitHub Actions：lint（no-unused-vars、no-legacy-route-import）、`npm run test:e2e` 确认 api_error 日志 | 建议在 `.github/workflows` 中增加 job：`npm run typecheck` / `eslint`（含 no-unused-vars、自定义 no-legacy-route-import 或等价规则），以及 e2e 步骤断言 audit_logs 或 `/metrics` 中出现 api_error 相关记录 |
| **监控报警** | Alertmanager：错误率 = errors/(errors+success) > 0.05，Slack 中带错误摘要 `{{ $labels.action }}` | 在 Prometheus 中配置告警规则，例如：<br>`(rate(conversation_api_errors_total[5m]) / (rate(conversation_api_errors_total[5m]) + rate(conversation_api_success_total[5m]))) > 0.05`<br>Alertmanager 路由到 Slack，annotation 中使用 `{{ $labels.action }}` 作为错误摘要 |

---

### 9️⃣ 如果仍然卡住——请提供以下信息

排查清单与脚本都跑过仍无法定位时，请按下面表格收集信息（可贴到 GitHub Issue 或发给维护者），便于复现与根因分析：

| 项目 | 示例 / 操作 |
|------|--------------|
| **后端日志（pm2 logs）** | 最近 10 行含 **logApiError** / **conversationApiErrors** 或 `[Global Error Handler]` 的片段（如 `pm2 logs api-1 --lines 50` 后筛选） |
| **前端 Network** | 任选**一次失败请求**：Request URL、Status code、Response body（Copy → Response 全文） |
| **audit_logs** | 执行后贴结果：<br>`SELECT * FROM audit_logs WHERE action LIKE 'api_error:%' ORDER BY created_at DESC LIMIT 5;` |
| **debug-conversation.js** | 脚本**完整输出**（尤其是第 2 步 DB 查询是否为空、第 3 步 HTTP 状态与响应体） |
| **Prometheus metrics** | `curl http://localhost:3000/metrics` 中与 `conversation_api_` 相关的行（或贴全文） |
| **错误列表 UI** | 屏幕截图（若状态列显示「已修复」而实际仍有报错，请一并说明） |

---

## Ⅳ 端到端排查脚本（帮助定位）

脚本 **`scripts/debug-conversation.js`** 一次性输出：

- 会话列表中**第 N 条**（默认第 1 条）对应的 **phone** 及列表项内容  
- 该 **phone** 在 DB 中 `message_tasks` 的最近 5 条记录（含 task id、status、error_msg）  
- 调用 **GET /api/user/chat/messages?peerPhone=xxx** 的返回（若异常则打印状态码与错误体）  
- 用于定位的 WHERE 条件（peerPhone、tenant_id）

**说明**：本项目无 `GET /api/conversations/:id`，列表为 `GET /user/chat/conversations`（按 phone 聚合），详情为 `GET /user/chat/messages?peerPhone=xxx`，故脚本以「列表第 N 条的 phone」作为详情入参。

### 使用方式

1. 在 **`.env`** 中配置 **`ADMIN_TOKEN`**（管理员 JWT，可用登录接口或现有 generate-token 类脚本获取）。可选：`API_BASE_URL`、`SERVER_PORT`、`TENANT_ID`、`DB_HOST` / `DB_USER` / `DB_PASSWORD` / `DB_NAME` 等（脚本会连 DB 做对比查询）。  
2. 在 **backend** 目录下执行：

```bash
# 列表 limit=20，取第 1 条
node scripts/debug-conversation.js 20 1

# 列表 limit=50，取第 5 条
node scripts/debug-conversation.js 50 5
```

3. 根据输出判断：**后端返回空** 是 SQL 条件（phone/tenant_id）不匹配，还是**授权/接口错误**（状态码与错误体），从而定位根因。

### 3️⃣ 快速定位脚本（debug-conversation.js）使用细节

**1️⃣ 先确保环境变量完整**

```bash
cp .env.example .env
```

必须配置（脚本从 `backend/.env` 读取）：

- **ADMIN_TOKEN**：管理员 JWT（必填，否则脚本退出）
- **TENANT_ID**：可选，默认 `1`（DB 中为数字，用于 WHERE tenant_id）
- **DB_HOST / DB_USER / DB_PASSWORD / DB_NAME**：用于脚本内直接查 `message_tasks`（若未配则用默认值，可能连不上库）

**2️⃣ 运行脚本**

```bash
# 在 backend 目录下（或从仓库根目录用 backend/scripts/...）
node scripts/debug-conversation.js 20 3
```

参数含义：**limit** = 每次拉取的会话条数（20），**index** = 取第几条（3 表示第 3 条，从 1 开始）。

脚本会依次输出 **三段**：

| 段落 | 内容 | 用途 |
|------|------|------|
| **1️⃣ 列表** | `GET /user/chat/conversations` 返回的列表项；选中的那条及用于详情的 **peerPhone** | 确认列表里的 phone 是否已被后端/前端标准化（如纯数字），与详情请求参数一致 |
| **2️⃣ DB 查询** | `SELECT ... FROM message_tasks WHERE target_phone = ? AND tenant_id = ? ORDER BY created_at DESC LIMIT 5` 的结果（最近 5 条） | 确认 **target_phone** 与第 1 步的 peerPhone **完全一致**（格式一致才能查到） |
| **3️⃣ 详情接口** | `GET /user/chat/messages?peerPhone=xxx` 的 HTTP 状态、响应体，以及打印的 WHERE 条件（peerPhone、tenant_id） | 若返回 `[]`，多半是第 2 步查不到对应任务（或 tenant_id 不一致） |

**若第 2 步查询为空**：说明历史数据里该会话的 `target_phone` 与当前列表返回的 peerPhone 格式不一致（例如库里有 `+1 234 567 89`，列表已标准化为 `123456789`）。请跑 **历史数据迁移**（见上文 **2️⃣ 「错误状态显示为已修复」→ D. DB 数据不统一**）：对 `message_tasks.target_phone`、`contacts.phone` 做一次统一为仅数字的 UPDATE 或脚本。

### 4️⃣ 常见错误 & 对应检查表（与文档 Ⅶ 互补）

| 错误码/类型 | 典型报错信息 | 检查点 | 快速 Fix |
|-------------|--------------|--------|----------|
| **404** | “Conversation not found” / 详情空 | • 本项目**无** `GET /conversations/:id`，是否误留该路由？<br>• 前端是否仍请求 `/conversations/${id}`（应改为 `peerPhone` 查详情） | 前端改为 `api.get('/user/chat/messages', { params: { peerPhone } })`；确保列表与详情共用同一 **peerPhone**（建议 normalizePhoneForApi） |
| **500** | “接口错误：xxx” | • `logApiError` 是否被触发？<br>• `incrementConversationError` 计数是否上升？ | 看 `pm2 logs` 中 **⚡ logApiError** 记录；查 `audit_logs` 最近 `api_error:*`；访问 `/metrics` 看 `conversation_api_errors_total` |
| **401** | “Token expired” / “invalid tenant” | • **ADMIN_TOKEN** 或前端 JWT 是否过期/错误？<br>• `audit_logs`、`message_tasks` 的 **tenant_id** 是否与 JWT 一致？ | 重新登录获取 JWT，或用现有登录接口/脚本生成新 token；确认请求头 `Authorization: Bearer <token>` |
| **429** | “Rate limit exceeded” | • `ops.ts` 中 **RATE_LIMIT_WINDOW_MS** / **RATE_LIMIT_MAX** 是否符合 SLA？<br>• 是否需在 Prometheus 中按 `action="rate_limit"` 打点？ | 调整 `.env` 或代码中的 `RATE_LIMIT_MAX`、`RATE_LIMIT_WINDOW_MS`；前端可做重试与退避 |
| **Login failed** | “Login failed for user X” | • 代理/卡密是否失效？<br>• **proxy_audit** 最近 5 条中 `action='test'` 的 detail 是否报错？ | 跑 `node scripts/proxy-check.mjs`；检查 `credentials`/`card_keys`；必要时重新激活卡密 |
| **ECONNREFUSED / Proxy** | “Cannot reach upstream” | • 代理配置（DB 中 `proxies` 或环境变量）是否指向正确 SOCKS/HTTP？<br>• **proxies.last_success_at** 是否超过 10 分钟未更新？ | 重启代理或更新代理配置；跑 proxy-check；禁用异常代理：`PATCH /api/proxies/:id` 传 `{ enabled: false }` |
| **Invalid phone** | “Invalid phone format” | • 前端 **normalizePhoneForApi** 是否在请求前统一调用？<br>• 后端 **normalizePhone** 是否在查询/写入前统一使用？ | 在 Chat 输入处加正则校验（如 `^[0-9]{7,15}$`）并提示用户；确认后端 `chat.ts` 对 peerPhone 已做 normalizePhone |

更简版对照见 **Ⅶ 常见错误快速定位小表**。

---

## Ⅴ 防止同类问题再次出现（运营规范）

| 项目 | 建议措施 | 负责团队 |
|------|----------|----------|
| **接口文档** | 为 **GET /api/user/chat/conversations**、**GET /api/user/chat/messages** 明确请求参数、返回字段、错误码；在前端开发手册中注明「必须调用详情接口」拉取消息（本项目为 `GET /user/chat/messages?peerPhone=xxx`，无 `/conversations/:id`）。 | Backend / Frontend |
| **监控告警** | 使用 `conversation_api_errors_total`（错误计数）、`conversation_api_success_total`（成功计数）；可补充 `conversation_api_latency_seconds`（响应时延）便于 SLA 监控。阈值：错误率 > 5% → Slack（由 Prometheus + Alertmanager 配置）。 | DevOps |
| **异常审计** | 在 **audit_logs** 中记录会话相关接口的 4xx/5xx（当前已在 catch 中记录 5xx 至 `api_error:*`；可按需扩展为每次 4xx/5xx 均落库，含 operator_id、路径、错误信息），便于事后追溯。 | Backend |
| **批量跑脚本** | 每天定时执行 **scripts/proxy-check.mjs**（代理健康）、以及可选 **scripts/heartbeat-conversations.js**（检查最近 24h 内是否存在 `status='Pending'` 却长期未被处理的 message_tasks），及时预警。 | Ops |
| **容量规划** | 根据发送量与子账号速率，提前预估 **sub_accounts.rate_limit** 及代理数量；定期评估并做自动伸缩（脚本加新代理、绑定新子账号）。 | Product / Ops |
| **权限审计** | 确认运营人员（非管理员）仅能访问 **自己 tenant_id** 下的会话与消息；列表与详情均依赖同一 JWT 的 tenant_id，避免因不同 token 导致列表与详情数据不一致。 | Security |

---

## Ⅵ 操作手册（一步一步在 Staging 验证）

### 准备

```bash
cp .env.example .env
# 填写 DB_*、REDIS_*、PROXY_ENC_KEY、CRED_ENC_KEY、ADMIN_TOKEN 等
npm ci
```

### 迁移

```bash
npm run db:migrate
```

### 种子数据（创建 1 条 credential、1 条卡密、1 条子账号、1 条代理）

```bash
npm run seed
# 或：tsx scripts/seed-test-data.ts
```

### 启动服务（API + Worker 进程）

```bash
# 先启动 API（如需前端调会话接口）
npm run dev
# 或生产：npm run build && npm start

# 另起终端：Worker 进程（每个进程内含 Scheduler 循环 + Worker，需 tsx）
pm2 start "tsx src/worker-entry.ts" --name worker-1
pm2 start "tsx src/worker-entry.ts" --name worker-2
```

（本项目 Scheduler 与 Worker 同属 **worker-entry.ts**，无需单独起 scheduler 进程。）

### 创建一条测试任务（假设手机号 +1(999)999-0001）

```bash
node scripts/send-flow-check.mjs --create-test +19999990001
```

（若无 Ready 账号，脚本会尝试用子账号调度插入 `account_id=NULL`，由 Scheduler 自动分配。）

### 检查任务是否成功（5–10 秒后）

```bash
node scripts/send-flow-check.mjs --failures
node scripts/send-flow-check.mjs --status +19999990001
```

### 打开前端

1. 访问 **https://&lt;host&gt;/admin/conversations**（或你部署的会话页路径）。  
2. 确认列表里出现该号码（如 +19999990001），**点击**后加载**完整对话**（包括所有消息内容）。  
3. 本项目**无** `/api/conversations/:id`，详情为 **GET /api/user/chat/messages?peerPhone=xxx**。若弹框空：  
   - 打开浏览器 **Network**，看是否有 **/api/user/chat/messages?peerPhone=...** 请求，记录 **status** 与 **response**。

### 调试（如有空白或错误）

- **后端日志**：`pm2 logs worker-1`（同一进程内含 Scheduler 与 Worker 日志）。  
- **数据库**：  
  `SELECT * FROM message_tasks WHERE target_phone = '19999990001' AND tenant_id = 1;`  
  `SELECT * FROM sub_accounts WHERE id = ?;`  
- **审计**：`SELECT * FROM audit_logs WHERE action LIKE 'api_error:%' ORDER BY created_at DESC LIMIT 5;`（本项目用 audit_logs，无单独 api_error_audit 表）。

### 确认

- 列表与详情均使用同一 JWT 的 **tenant_id**；列表条数、bind_count（若展示）与预期一致。  
- **代理状态**：`SELECT id, is_active, last_success_at, last_error_msg FROM proxies WHERE id = ?;`，确认 last_success_at 最近有更新。  
- **卡密/凭证**：`SELECT status FROM card_keys WHERE id = ?;`、`SELECT id, type, username FROM credentials WHERE id = ?;`。

### 完成后（若所有检查 ✅）

- 将 `.env`、pm2 ecosystem（含 API、worker-1/worker-2）纳入 CI/CD，在生产执行相同流程。  
- 启动监控（如 Grafana）并配置告警（见 Ⅲ / Ⅴ）。

---

## Ⅶ 常见错误快速定位小表

| 错误信息 | 检查点 | 可能解决方案 |
|----------|--------|--------------|
| **404 或 详情空** | ① Network 中详情请求是否为 **GET /api/user/chat/messages?peerPhone=xxx**（本项目无 `/conversations/:id`）<br>② DB 中是否有该 `target_phone` + `tenant_id` 的 message_tasks | 检查前端传的 peerPhone 是否与列表项 phone 一致（建议统一用纯数字）；查 `SELECT * FROM message_tasks WHERE target_phone = ? AND tenant_id = ?;`。 |
| **500 Internal Server Error** | 查看 pm2 logs 中对应时间的 stack trace。常见原因：<br>• 解密密码为 null（auth_pass_enc）<br>• JSON.parse 报错（tags 非 JSON） | 代理密码加密后再存；确认 tags 列为 NULL 或有效 JSON（如 `["a","b"]`）。 |
| **401 Unauthorized** | 请求头是否携带 **Authorization: Bearer &lt;JWT&gt;** | 前端在 axios 拦截器或 defaults.headers 中加 Bearer token；脚本用 `-H "Authorization: Bearer $TOKEN"`。 |
| **Rate limit exceeded** | `sub_accounts.rate_counter` 已满 | `UPDATE sub_accounts SET rate_counter=0, rate_reset_at=NOW() WHERE id=?;` 或提高 rate_limit、增加子账号数量。 |
| **Login failed** | `credentials.password_hash` 与平台不匹配 | 重新生成 bcrypt hash，更新 credentials 表。 |
| **ECONNREFUSED / ETIMEDOUT** | 代理不可达或端口错误 | 用 `curl -x "http://user:pass@host:port"` 测试；确认代理可用后启用（或运行 `node scripts/proxy-check.mjs`）。 |

---

## Ⅷ 如果还有疑问，请提供以下信息

- **后端日志片段**：`pm2 logs worker-1`（或实际 worker 进程名）中出现的**错误栈**。  
- **前端 Network**：点击某条会话时的**请求 URL**（应为 `/api/user/chat/messages?peerPhone=...`）、**返回码**、**响应体**（尽量贴完整 JSON）。  
- **SQL 查询结果**：`SELECT * FROM message_tasks WHERE target_phone = ? AND tenant_id = ?;`（替换为实际 phone、tenant_id）是否有记录。  
- **proxy_audit**：最近 5 条记录（是否测试成功或报错）：  
  `SELECT * FROM proxy_audit ORDER BY id DESC LIMIT 5;`

---

## 快速检查命令（MySQL）

```sql
-- 会话是否有消息（替换 ? 为实际 phone、tenant_id）
SELECT id, target_phone, status, error_msg, created_at FROM message_tasks WHERE target_phone = ? AND tenant_id = ? ORDER BY created_at DESC LIMIT 20;

-- 子账号限流
SELECT id, rate_counter, rate_limit, rate_reset_at, status FROM sub_accounts WHERE status = 'ready';

-- 联系人是否被软删
SELECT phone, pinned, banned, deleted, unread_count FROM contacts WHERE phone = ?;
```
