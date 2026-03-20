# 导入工具与服务器接口验证

## 工具位置

- 脚本：`frontend/tools/import_tn_accounts.py`
- 示例数据：`frontend/data/tn_accounts_full_example.json`

## 与服务器接口的适配

| 项目       | 说明 |
|------------|------|
| 接口路径   | `POST /api/tn-accounts/import`（已下线，固定返回 404） |
| 请求格式   | `Content-Type: application/json`，Body：`{"accounts": [ { "phone", "username", "password", "token", "clientId", "signature", ... } ]}` |
| 预期响应   | HTTP 404，Body：`{"error":"Import API has been discontinued. Use CLI script or internal tool for bulk import."}` |

## 如何验证对齐

1. **本地验证**（需先启动后端）  
   在项目根目录或 `frontend` 下执行：
   ```bash
   # 从 frontend 目录
   python tools/import_tn_accounts.py --file data/tn_accounts_full_example.json
   # 或指定 API
   python tools/import_tn_accounts.py --file data/tn_accounts_full_example.json --api http://localhost:3000/api/tn-accounts/import
   ```
   预期：输出 `HTTP 404`、上述 JSON，以及 `[适配结果] 与服务器一致：接口已下线，返回 404 为预期。`

2. **对线上/测试服务器验证**  
   ```bash
   python tools/import_tn_accounts.py --file data/tn_accounts_full_example.json --api https://你的域名/api/tn-accounts/import
   ```
   若服务器与当前后端一致，同样会得到 404 及相同 `error` 文案。

3. **连接失败时**  
   若未启动后端或 URL 错误，脚本会输出「连接失败」及提示，不会抛未捕获异常。

## 批量导入的替代方式

接口下线后，批量写入请使用：

- 后端 CLI 或内部脚本直接写 `accounts` 表；
- 或保留的 `backend/src/shared/import-normalizer.js` 做字段规范化后插入。
