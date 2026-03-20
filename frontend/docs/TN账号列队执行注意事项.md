# TN 账号（TextNow）列队执行任务 — 注意事项

本节针对 **massmail** 项目中 **TextNow 协议账号** 在 **队列执行发送任务** 时的前置条件、并发、限流、错误与监控做统一说明。任务保存在 `message_tasks`，调度与发送由 `backend` 的 scheduler + worker（BullMQ + Puppeteer/TextNow 自动化）完成。

---

## Ⅰ 账号前置条件（登录、代理、会话）

| 项目 | 为什么必须检查 | 操作要点 | 说明 |
|------|----------------|----------|------|
| **登录凭证** | 未登录或 session 失效会导致发送失败，`error_msg` 常为 "Login failed" | 在「账号管理」中完成登录/探测，系统将 `tn_session_token_cipher`、`tn_session_id` 持久化；凭证失效后需重新登录或更新密码 | Worker 使用 `TextNowAutomation.executeFullFlow`，依赖账号的 username/password 与解密后的 session |
| **代理（IP）** | TextNow 对机房 IP 敏感，固定公网易触发风控 | 在「IP 配置」中为账号**绑定代理**（`account_proxy_bindings` + `proxies`）；调度器**无代理不派发**该任务 | 每条发送任务都会通过该账号绑定的代理 IP 发出 |
| **账号状态** | 只有 `status = 'Ready'` 的账号才会被调度器选用 | 被置为 Cooldown/Dead 的账号需在后台恢复或重新探测；`Login failed` 后会自动置为 Cooldown，避免反复失败 | 见「错误处理」 |
| **租户** | 多租户下只使用本租户账号 | `accounts.tenant_id` 与 `message_tasks.tenant_id` 一致，调度时按 `tenant_id` 过滤 | - |

**关键**：账号需同时满足 **Ready**、**有代理绑定**、**会话有效**（或可重新登录），调度器才会把任务派发到该账号。

---

## Ⅱ 任务队列模型（并发安全与重试）

- **取任务**：调度器每轮从 `message_tasks` 中取 `status IN ('Pending','PENDING')` 且 `scheduled_at <= NOW()` 且 `(retry_at IS NULL OR retry_at <= NOW())` 的任务，使用 **`FOR UPDATE SKIP LOCKED`**，避免多实例抢同一条。
- **锁定**：选中任务后先占 Redis 账号锁，再把任务更新为 `LOCKED`、账号更新为 `Busy`，然后推入 BullMQ 队列 `tn-send`。
- **发送**：Worker 消费队列，用 Puppeteer + 该账号绑定的代理执行 TextNow 发信；成功则任务置为 `Sent`、账号置回 `Ready`；失败则进入统一回滚（见下）。
- **超时释放**：若任务长时间停留在 `LOCKED`/`Processing` 或账号长时间 `Busy`，调度器会按超时时间将任务恢复为 `Pending`、账号恢复为 `Ready`（并清空 `retry_at`），避免卡死。

---

## Ⅲ 并发控制（单账号同时只执行一条）

- 同一账号在同一时刻只会被**一个**任务占用：调度器派发前用 **Redis 分布式锁** 占住 `accountId`，再将该账号设为 `Busy`；Worker 完成后才把账号设回 `Ready` 并释放锁。
- 若需多 Worker 进程水平扩展，现有逻辑（Redis 锁 + `FOR UPDATE SKIP LOCKED`）可保证不重复派发、不重复占用同一账号。

---

## Ⅳ 速率限制（Rate Limit）与 429 重试

- **表结构**：`accounts` 表已支持 `rate_limit`、`rate_window_sec`、`rate_counter`、`rate_reset_at`（可选使用）。
- **429 处理**：当发送过程触发平台限流（如 `error_code = 429` 或错误信息含 "Rate limit"），Worker 会将任务状态恢复为 **`Pending`** 并设置 **`retry_at = NOW() + 60 秒`**；调度器取任务时会排除 `retry_at > NOW()` 的，从而自动延迟重试。
- 若需按账号维度做发送速率控制，可在调度器分配账号前增加对 `rate_counter`/`rate_reset_at` 的检查与递增逻辑（当前为预留字段）。

---

## Ⅴ 常见错误与处理（与 `--failures` 对照）

| 错误表现 / error_msg | 业务含义 | 系统处理 | 建议操作 |
|----------------------|----------|----------|----------|
| **Login failed** / 登录失败 | Session/登录失效 | 账号状态置为 **Cooldown**，不再参与调度 | 到「账号管理」更新密码或重新探测/登录 |
| **429 / Rate limit** | 平台限流 | 任务恢复为 Pending，设置 `retry_at` 约 60 秒后重试 | 可调低单账号发送频率或增加间隔 |
| **代理不可达 / ECONNRESET** | 代理或网络问题 | 按连续失败次数累加，达阈值后账号置为 Cooldown | 检查「IP 配置」中代理可用性，或更换代理 |
| **Message input not found** 等页面异常 | TextNow 页面结构变化或加载超时 | 任务标记为 Failed，错误写入 `error_msg` | 查看 `pm2 logs massmail-worker` 与 `--failures` 完整信息 |

运行 **`node scripts/send-flow-check.mjs --failures`** 可查看最近失败任务的完整 `error_msg`、`error_code` 及发送时使用的代理 IP，便于对照上表排查。

---

## Ⅵ 监控与自检

| 维度 | 建议方式 |
|------|----------|
| **任务成功率** | `SELECT COUNT(*) FROM message_tasks WHERE status='Sent' AND created_at > DATE_SUB(NOW(), INTERVAL 1 HOUR);` 与同时间段总任务数对比 |
| **失败原因分布** | 定期执行 `node scripts/send-flow-check.mjs --failures`，或查 `SELECT error_msg, COUNT(*) FROM message_tasks WHERE status='Failed' AND updated_at > DATE_SUB(NOW(), INTERVAL 1 DAY) GROUP BY error_msg;` |
| **队列堆积** | `SELECT COUNT(*) FROM message_tasks WHERE status IN ('Pending','PENDING') AND created_at < DATE_SUB(NOW(), INTERVAL 30 MINUTE);` 若长期 > 0 需检查 Worker 是否运行、是否有 Ready+代理 账号 |
| **账号异常** | `SELECT id, username, status, error_msg FROM accounts WHERE status IN ('Cooldown','Dead') AND updated_at > DATE_SUB(NOW(), INTERVAL 1 DAY);` |

---

## Ⅶ 排查清单（卡点速查）

| 步骤 | 检查点 | 操作 |
|------|--------|------|
| 1 | Worker 是否在跑 | `pm2 list` 确认 `massmail-worker` 为 online |
| 2 | Redis 是否可用 | `redis-cli ping` 或运行 `node scripts/send-flow-check.mjs` 看 Redis 是否 OK |
| 3 | 是否有可发信账号 | 同上脚本，看「Ready 且带代理」数量是否 > 0 |
| 4 | 任务是否被 retry_at 推迟 | 查 `SELECT id, status, retry_at FROM message_tasks WHERE status='Pending' AND retry_at > NOW();` |
| 5 | 失败原因 | `node scripts/send-flow-check.mjs --failures`，对照「常见错误与处理」 |
| 6 | 僵尸锁 | 若任务/账号长期卡在 LOCKED 或 Busy，调度器会按超时自动释放；必要时可执行文档《请求任务不执行排查》中的释放 SQL |

---

## Ⅷ 小结

- **列队执行** 依赖：账号 **Ready + 有代理 + 会话有效**；调度器 **FOR UPDATE SKIP LOCKED** 与 **retry_at** 过滤；Worker 统一回滚与 **Login failed → Cooldown**、**429 → retry_at**。
- **完整错误信息** 通过 `message_tasks.error_msg`（TEXT）保存，并用 **`--failures`** 查看；发送时使用的代理 IP 会在失败检查中一并输出，便于定位网络/代理问题。
- 按上述清单逐项检查，可快速排除「不派发」「重复派发」「只失败不重试」「登录/代理类卡点」等问题。

---

## Ⅸ 相关文档

- **《导入账号之后的使用逻辑》**：说明账号从哪来（CLI/脚本/内部 API）、写入 `accounts` 后如何被调度器选用、任务创建时是否/如何指定账号、从导入到发送的完整闭环及 FAQ、运维 SOP。
