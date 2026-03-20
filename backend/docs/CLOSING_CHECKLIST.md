# 代理模块收尾检查清单

## 一、代码与构建

- [x] **backend 编译**：`npm run build` 通过
- [x] **Lint**：proxy-schema、proxy 路由、scheduler、worker 无报错
- [x] **Session 一致性**：scheduler 在锁定前解析代理，无代理则跳过任务；入队必带 `proxyUrl`；worker 仅用 job 内 `proxyUrl`
- [x] **去硬编码**：campaign 策略 mock 中 `proxy_url` 已改为 `null`

## 二、数据库

- [x] **proxies 表**：proxy-schema 创建/迁移完整（含 last_latency_ms、country/region/city 等）
- [x] **account_proxy_bindings 表**：外键指向 accounts、proxies，唯一 (account_id, proxy_id)
- [x] **依赖**：bindings 依赖 `accounts` 表；先有 accounts 再访问代理 API 或跑调度
- [x] **建表脚本**：`scripts/schema_full_create.sql` 可一次性建齐 7 张表；`scripts/create_proxy_tables.sql` 仅 accounts+proxies+bindings
- [x] **字段参考**：`docs/DATABASE_FIELDS_REFERENCE.md` 列出全部表与字段，便于本地可视化连接

## 三、API

- [x] **挂载**：`app.use("/api", proxyRouter)`，前缀 `/api`
- [x] **接口**：GET/POST /api/proxies、GET /api/system/proxies/status、GET/POST /api/proxies/bindings、POST /api/proxies/bind、POST /api/proxies/:id/check、DELETE /api/proxies/:id
- [x] **中间件**：每次请求先 `ensureProxySchema(conn)`，再执行业务
- [x] **状态接口**：GET /api/system/proxies/status 做探测并返回 total/alive/dead/avgLatencyMs/items

## 四、验证与文档

- [x] **DB 检查脚本**：`npx tsx scripts/check_proxy_db.ts` 校验连接与 proxy 表；若缺 accounts 会明确报错并退出
- [x] **说明文档**：`PROXY_MODULE_CHECK.md` 含连接说明、API 列表、调度/Worker 调用链与 curl 自测示例
- [x] **生产启动**：`npm run start:prod`（cross-env NODE_ENV=production）

## 五、建议上线前自测

1. 执行 `schema_full_create.sql` 或先 `setup_db.js` 再访问代理 API，确保 accounts 存在。
2. `curl -s http://localhost:3000/api/health` 返回正常。
3. `curl -s http://localhost:3000/api/proxies` 返回 `{"code":0,"data":[]}`。
4. `curl -s http://localhost:3000/api/system/proxies/status` 返回含 total/alive/items 的 JSON。
5. 为账号绑定代理后，跑调度器确认任务带 `proxyUrl` 入队且 worker 能正常发信。

---

收尾完成日期：按本清单逐项勾选即可。
