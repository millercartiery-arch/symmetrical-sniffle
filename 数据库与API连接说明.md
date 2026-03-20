# 数据库与 API 连接说明

## 一、数据库连接（后端）

- **位置**：`backend/src/shared/db.ts`
- **类型**：MySQL（`mysql2/promise` 连接池）
- **环境变量**（在 `backend/.env` 中配置）：

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `DB_HOST` | 数据库主机 | `localhost` |
| `DB_PORT` | 端口 | `3306` |
| `DB_USER` | 用户名 | `massmail` |
| `DB_PASSWORD` | 密码 | **必填** |
| `DB_NAME` | 库名 | `massmail` |

**操作步骤：**

1. 复制 `backend/.env.example` 为 `backend/.env`
2. 填写 `DB_PASSWORD` 及需要覆盖的其它项
3. 确保 MySQL 已创建数据库 `massmail` 并执行过建表脚本（见 `backend/scripts/`）
4. 启动后端：`cd backend && npm run dev`（或 `npm start`）

**健康检查**：访问 `GET /api/health`，若配置了 `DEBUG_DB_TARGET=true`，响应中会包含当前连接的 `host`、`database`。

---

## 二、API 连接（前端 → 后端）

- **位置**：`frontend/src/api.ts`
- **方式**：Axios 实例，`baseURL` 来自环境变量
- **环境变量**（在 `frontend/.env.development` 或 `frontend/.env.production` 中配置）：

| 变量 | 说明 | 当前示例 |
|------|------|----------|
| `VITE_API_BASE_URL` | 后端 API 根地址（需含 `/api`） | `https://hkd.llc/api` |

**请求流程：**

1. 前端调用：`api.get('/accounts')`、`api.post('/login', { username, password })` 等
2. 实际请求 URL = `VITE_API_BASE_URL` + 路径，例如：`https://hkd.llc/api/accounts`
3. 请求头自动带 `Authorization: Bearer <JWT>`（登录后由 `jwt-auth` 提供）
4. 后端路由挂在 `/api` 下（见 `backend/src/index.ts`），例如：
   - `GET/POST /api/accounts` → `backend/src/routes/account.ts`
   - `POST /api/login` → `backend/src/routes/auth.ts`
   - `GET /api/dashboard/stats` → `backend/src/routes/dashboard.ts`

---

## 三、本地开发：前后端 + 数据库一体连接

1. **后端**  
   - 在 `backend/.env` 中配置好 `DB_*`（本地 MySQL 或远程库）  
   - 启动：`cd backend && npm run dev`，默认端口 `3000`

2. **前端**  
   - 让前端请求本地后端：在 `frontend` 下新建 **`.env.development.local`**（会覆盖 `.env.development`）：
   ```env
   VITE_API_BASE_URL=http://localhost:3000/api
   VITE_SOCKET_BASE_URL=http://localhost:3000
   ```
   - 启动：`cd frontend && npm run dev`

3. **验证**  
   - 浏览器打开前端，登录后进入「账号管理」  
   - 若列表能正常加载，说明前端 → 后端 API → 数据库 已连通

---

## 四、现有后端与数据库的对应关系（摘要）

| 功能 | 路由示例 | 使用的表/数据 |
|------|----------|----------------|
| 登录 | `POST /api/login` | `users` |
| 账号列表/分页 | `GET /api/accounts` | `accounts` |
| 账号 ID 列表 | `GET /api/accounts/ids` | `accounts` |
| 看板统计 | `GET /api/dashboard/stats` | `accounts`、任务等 |
| 子账号 | `GET/POST /api/sub-accounts` | 子账号相关表 |
| 代理池 | `/api/proxy/*` | 代理相关表 |

数据库连接由 `backend/src/shared/db.ts` 的 `pool` 统一提供，各路由通过 `import { pool } from '../shared/db.js'` 使用。
