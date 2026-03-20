# IP 配置面板（IP-Proxy Management）说明

基于《IP 配置面板设计方案》对当前实现的对齐说明与使用方式。

---

## 一、已实现功能

| 需求 | 实现说明 |
|------|----------|
| **F-01 列表展示** | `GET /api/proxies` 支持分页（`page`, `pageSize`）、搜索（`search`：host/description/region）、过滤（`protocol`, `enabled`, `region`）。返回字段含 description、tags、weight、last_checked_at、last_error_msg、**bind_count**（= account_proxy_bindings 绑定数 + sub_accounts.proxy_id 绑定数）。 |
| **F-02 新增/编辑** | 单条：`POST /api/proxies`（body：protocol, host, port, username?, password?, description?, region?, tags?, weight?, enabled?）；`PATCH /api/proxies/:id` 部分更新。前端「IP 配置」Tab：新增按钮 + 弹窗表单；表格行「编辑」。 |
| **F-03 批量导入** | 保留原有「手动导入」：多行文本 `protocol://user:pass@host:port` 或 `host:port:user:pass`，提交为 `POST /api/proxies` 的 `{ proxies: [...] }`。CSV 文件导入为后续扩展。 |
| **F-04 连通性测试** | `POST /api/proxies/:id/test`（可选 body：`pingUrl`，默认 `https://api.tn.com/ping`）。返回 `{ ok, latency, status, error }`，并更新 last_checked_at、last_success_at、last_error_msg。表格行「测试」按钮，结果在 message 中展示。兼容旧接口：`POST /api/proxies/:id/check`。 |
| **F-05 绑定/解绑** | `POST /api/proxies/bind`（accountId, proxyId, sessionKey, isPrimary）；账号详情中通过「IP 配置」为账号绑定代理（见 AccountConfigDrawer / 绑定流程）。 |
| **F-06 状态监控** | 表格列：最后检测时间、延迟、last_error_msg（失败时在最后检测列提示 ⚠）。批量检测：`GET /api/system/proxies/status`（全量探测并写回 last_checked_at、last_alive、last_latency_ms 等）。 |
| **F-07 批量操作** | 表格多选 + 批量删除可扩展；当前支持单条启用/禁用（Switch）、单条删除。 |
| **F-08 审计** | `proxy_audit` 表：create/update/delete/test 写入 action、operator_id（`req.user.id` 或 `X-Operator-Id`）、detail（JSON）；外键 `proxy_id → proxies.id` ON DELETE SET NULL。 |
| **F-09 权限** | 与现有后台鉴权一致（需登录）；角色/ RBAC 可在路由层按需加 `proxy_manager`。 |
| **F-10 响应式** | Ant Design Table + Modal，支持窄屏滚动。 |

---

## 二、数据模型（当前）

- **proxies**：含 `description`、`tags`（JSON）、`weight`、`last_success_at`、`last_error_msg`、**auth_pass_enc**（AES-256-GCM 加密后 base64 存库；密钥 `PROXY_ENC_KEY` 或回退 `MSG_ENC_KEY`）。明文 `password` 仅用于兼容旧数据，新写入仅填 `auth_pass_enc`。
- **account_proxy_bindings**：账号与代理多对多，字段不变（account_id, proxy_id, session_key, is_primary, is_active）。
- **proxy_audit**：id, proxy_id, action, operator_id, detail(JSON), created_at。
- **sub_accounts.proxy_id**：外键 `fk_sub_accounts_proxy` → `proxies(id)` **ON DELETE SET NULL**，代理被删时子账号自动解绑。

---

## 三、API 一览

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/proxies | 列表（分页、search、protocol、enabled、region） |
| GET | /api/proxies/:id | 单条详情（含 bind_count） |
| POST | /api/proxies | 单条创建（body 见上）或批量（body.proxies 数组） |
| PATCH | /api/proxies/:id | 部分更新 |
| DELETE | /api/proxies/:id | **软删除**（`is_active=0` + 写 proxy_audit），不删行；返回 `{ soft: true }`。 |
| POST | /api/proxies/:id/test | 连通性测试（可选 pingUrl） |
| POST | /api/proxies/:id/check | 兼容旧版，同 test |
| GET | /api/proxies/bindings | 所有绑定关系 |
| POST | /api/proxies/bind | 绑定账号与代理 |
| GET | /api/system/proxies/status | 批量探测并更新状态 |

---

## 四、前端入口与旧代码清理

- **入口**：账号管理页 → Tab「IP 配置」→ ProxyPoolTab。
- **保留**：基础配置（拉取 API、白名单 API、服务器公网 IP）、手动导入、IP 列表表格、刷新列表。
- **新增**：表格列（描述、标签、权重、启用 Switch）、新增/编辑弹窗、单条测试（展示延迟/错误）、启用/禁用 Switch。
- **移除**：无单独删除的页面；已去掉重复的 bindings/bind 路由定义，列表与单条接口统一。

---

## 五、密码与删除策略

- **密码加密**：前端仍以明文提交 `password`，后端使用 `encryptProxyPassword()` 写入 **auth_pass_enc**（AES-256-GCM + base64），列表/详情接口**不返回** `password`、`auth_pass_enc`。测试与探测时内存中解密使用，审计与日志不记录明文。
- **软删除**：`DELETE /api/proxies/:id` 仅执行 `UPDATE proxies SET is_active = 0`，不物理删行；已绑定该代理的子账号若存在外键 `ON DELETE SET NULL`，在物理删除时会被自动解绑（当前仅软删不会触发）。

## 六、与设计文档的差异（可选后续）

- 批量导入 CSV：可增加 `POST /api/proxies/import`（multipart file）解析 CSV 后调用与批量相同的写入逻辑。
- 导出 CSV：可增加 `GET /api/proxies/export`，用列表参数过滤后返回 CSV 流。
- 账号详情页「更换代理」：✅ 已实现。AccountConfigDrawer 中「IP 配置 / 更换代理」区块：展示当前绑定、下拉选择已有 proxy、点击「绑定」调用 `POST /api/proxies/bind`。
- **环境变量**：部署时需配置 `PROXY_ENC_KEY`（32 字节 base64，如 `openssl rand -base64 32`）；未配置时回退到 `MSG_ENC_KEY`。
