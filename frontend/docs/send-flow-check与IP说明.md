# send-flow-check 与 IP（代理）说明

本文对照《简要结论》文档，说明本项目中 **send-flow-check.mjs** 的实现情况与差异。

---

## 一、结论概览

| 文档要点 | 本项目实现 |
|----------|------------|
| **执行时不需要在命令行传 IP** | ✅ 已满足。脚本无 `--ip` 参数；代理来自账号（account）或子账号（sub_account）的绑定。 |
| **IP 是账号层面配置** | ✅ 已满足。代理来自 `account_proxy_bindings` + `proxies`，或账号表备用字段 `accounts.proxy_url`。 |
| **--failures 报告里应看到 IP/代理** | ✅ 已实现。输出中含「发送时连接 IP（代理）」：优先显示绑定代理，无绑定时显示 `accounts.proxy_url`，都没有则「未绑定代理」。 |
| **按 IP 过滤失败任务** | ✅ 已实现。支持 `--failures-by-ip <URL>`，仅显示使用该代理的失败任务。 |

---

## 二、数据层差异（MySQL，非 MongoDB）

文档中的示例使用 **MongoDB**（`db.collection('tasks')`、`accounts.proxy`）。本项目为 **MySQL**，对应关系如下：

| 文档（Mongo） | 本项目（MySQL） |
|---------------|------------------|
| tasks 集合 | message_tasks 表 |
| accounts 集合、accounts.proxy | accounts 表；代理来自 account_proxy_bindings + proxies，或 accounts.proxy_url |
| $lookup | SQL LEFT JOIN（脚本中已用） |

脚本已按 MySQL 模型实现：失败任务 JOIN accounts、account_proxy_bindings、proxies，并增加 accounts.proxy_url 作为备用展示。

---

## 三、脚本用法（backend 目录下）

```bash
cd backend

# 失败原因检查（含账号代理）
node scripts/send-flow-check.mjs --failures

# 仅显示使用指定代理的失败任务
node scripts/send-flow-check.mjs --failures-by-ip "http://10.1.2.3:1080"

# 插入测试任务并轮询 90 秒（自动选用 Ready+代理 账号或子账号）
node scripts/send-flow-check.mjs --create-test 13800138000
```

---

## 四、本次完善内容

1. **失败报告中代理展示完善**
   - SELECT 中增加 `a.proxy_url AS account_proxy_url`。
   - 展示逻辑：有绑定代理则显示 `protocol://host:port`，否则显示 `accounts.proxy_url`，都没有则显示「未绑定代理」。

2. **按代理过滤：--failures-by-ip**
   - 支持 `--failures-by-ip <URL>`。
   - 先查询最多 100 条失败任务，在内存中按「发送时连接 IP（代理）」过滤，再输出最多 20 条。

3. **注释与用法**
   - 脚本头部注释已补充 `--failures-by-ip` 的用法说明。

---

## 五、与文档「常见坑」的对应

| 文档症状 | 本项目处理 |
|----------|------------|
| 报告里没有「账号代理」 | 已通过 JOIN + account_proxy_url 展示；无绑定时会显示 proxy_url 或「未绑定代理」。 |
| 想只看某条代理的错误 | 使用 `--failures-by-ip "http://..."`。 |
| 表不存在 | 脚本捕获 ER_NO_SUCH_TABLE，提示先执行 schema（如 schema_full_create.sql）。 |

---

**总结**：脚本已按「IP 作为账号属性、不在 CLI 传 IP、报告中展示并可按代理过滤」的思路完善，与文档结论一致；数据层为 MySQL，实现方式与文档中的 Mongo 示例等价。
