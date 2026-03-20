# IP 池优化配合说明

本文说明「IP 池优化配合」的约定与当前实现，与《IP 配置面板说明》《修复日记》中的网络调度中心需求对齐。

---

## 一、优化配合内容

| 项目 | 说明 | 实现状态 |
|------|------|----------|
| **网络调度中心卡片** | 在 IP 配置 Tab 顶部展示 IP 池整体状态 | ✅ 已实现 |
| **GET /api/system/proxies/status** | 后端全量探测代理并写回 last_checked_at、last_alive、last_latency_ms 等 | ✅ 已实现（仅 proxy.ts，web-controller 中重复实现已移除） |
| **展示 total / alive / dead / avgLatencyMs** | 卡片内展示总数、存活数、不可用数、平均延迟 | ✅ 已实现 |
| **刷新状态按钮** | 用户点击后重新请求 status 并刷新展示 | ✅ 已实现 |
| **检测时间** | 显示最近一次探测时间 | ✅ 已实现 |

---

## 二、前端实现（ProxyPoolTab）

- **入口**：账号管理 → Tab「IP 配置」→ 首块卡片「网络调度中心」。
- **行为**：
  - 进入 Tab 时自动请求一次 `GET /api/system/proxies/status`（不传 `force`），用于首屏展示。
  - 点击「刷新状态」时带 `?force=true` 重新探测（若后端支持缓存则 bypass 缓存）。
  - 响应形态：`data: { total, alive, dead, avgLatencyMs, checkedAt, items }`（由 proxy.ts 提供）。
  - 卡片内展示：总数、存活、不可用、平均延迟(ms)、检测时间。

---

## 三、后端接口说明

- **路径**：`GET /api/system/proxies/status`
- **可选参数**：`force=true` 时部分实现会忽略缓存并重新探测。
- **返回**：`data.total`、`data.alive`、`data.dead`、`data.avgLatencyMs`、`data.checkedAt`、`data.items`
- **探测逻辑**：对 `proxies` 表中启用中的代理做连通性探测，并写回 `last_checked_at`、`last_alive`、`last_latency_ms`、`status` 等；前端列表的「最后检测」「延迟」列会随之更新。

---

## 四、与设计文档的对应

- **《IP 配置面板说明》F-06 状态监控**：表格列已有「最后检测」「延迟」；本优化在此基础上增加**整池概览**与**一键刷新状态**，与「批量检测 GET /api/system/proxies/status」配合使用。
- **《修复日记》「IP 池网络调度中心前端」**：在 ProxyPoolTab 中补全卡片、调用 status 接口、展示 total/alive/dead/avgLatencyMs 及「刷新状态」按钮，已按该说明实现。

---

## 五、使用建议

1. 首次打开 IP 配置 Tab 会自动拉取一次状态，若代理较多可能稍慢，属正常。
2. 需要最新探测结果时点击「刷新状态」；刷新后下方 IP 列表的「最后检测」「延迟」等列会随接口写回而更新，可再点「刷新列表」同步表格。
3. 该接口由 `backend/src/routes/proxy.ts` 唯一提供；此前 web-controller 中的重复挂载已移除。
