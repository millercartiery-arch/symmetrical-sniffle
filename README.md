# Cartier & Miller / Massmail 全栈项目

全栈应用：React 前端 + Node 后端 + Tauri 桌面客户端。支持 Web 与桌面双端部署。

## 项目结构

```
desktop-build-source/
├── frontend/          # React + Vite 前端
├── backend/           # Express API 服务
├── src-tauri/         # Tauri 桌面壳
├── scripts/           # 构建与部署脚本
└── package.json       # npm workspaces 根
```

## 环境要求

- **Node.js** 18+
- **npm** 9+（或 pnpm / yarn）
- **MySQL** 8（后端数据库；建库与迁移在**服务器**完成，本地可预留只读连接作可读数据库视图，见 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)）
- **Redis**（可选，队列/锁；未启仅影响部分功能）
- **Rust**（仅构建 Tauri 桌面时需要）

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 后端

```bash
cd backend
cp .env.example .env
# 编辑 .env：DB_*、JWT_SECRET、PORT 等
npm run dev
```

默认 API：`http://localhost:3000`，健康检查：`GET /health`、`GET /api/health`。

### 3. 前端

```bash
cd frontend
# 开发默认代理到 127.0.0.1:3000，与根目录 npm run dev 打通
npm run dev
```

浏览器打开终端显示的地址（如 `http://localhost:8080`）。用域名或局域网 IP 访问时，请使用终端里 **Network** 一行地址。

### 4. 同时启动前后端（根目录，推荐）

```bash
npm run dev
```

会同时启动后端（端口 3000）和前端（端口 8080）；前端自动把 `/api` 代理到本地后端，登录与接口即打通，无需再配 CORS 或 `VITE_BACKEND_TARGET`。要连远程 API 时在 `frontend/.env.development` 中设置 `VITE_BACKEND_TARGET=https://hkd.llc`。

### 4.1 远程调试（局域网 / 本机 IP 访问）

- 后端默认监听 `0.0.0.0`，前端 Vite 已设 `host: '0.0.0.0'`，可从同一局域网内其他设备访问。
- 在本机执行 `npm run dev` 后，在手机/平板或另一台电脑浏览器打开：**http://\<本机 IP\>:8080**（如 `http://192.168.8.157:8080`，以终端里 Vite 打印的 Network 地址为准）。
- 若本机防火墙拦截，需放行 8080、3000 端口。
- 需在 Cursor/VS Code 里断点调试后端时，可用 `.vscode/launch.json` 中的「Launch Backend (inspect)」启动后端，再使用「Attach to Backend」连接。

### 5. 桌面端（Tauri）

```bash
npm run desktop:dev
# 或先起前端再起桌面：npm run desktop:dev:full
```

## 环境变量

### 后端 `backend/.env`

| 变量 | 说明 |
|------|------|
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | MySQL 连接 |
| `REDIS_URL` | Redis 地址（可选） |
| `PORT` | API 端口，默认 3000 |
| `NODE_ENV` | `development` / `production` |
| `JWT_SECRET` | JWT 签名密钥（建议 32 位以上） |
| `CORS_ORIGINS` 或 `ALLOWED_ORIGINS` | 生产环境允许的前端来源，逗号分隔 |
| `FRONTEND_DIR` | 生产环境前端静态目录（可选，用于同机托管前端） |

详见 `backend/.env.example`。

### 前端

- **开发**：`frontend/.env.development`、`frontend/.env.development.local`  
  - `VITE_API_BASE_URL` 留空则使用相对路径 `/api`，由 Vite 代理到后端，支持域名/本机访问。
- **生产**：`frontend/.env.production`、`frontend/.env.production.local`  
  - 需配置 `VITE_API_BASE_URL`、`VITE_SOCKET_BASE_URL` 等，参考 `frontend/.env.production.example`。

## 构建与部署

### 前端静态构建

```bash
npm run build:frontend
# 产出：frontend/dist
```

### 后端

```bash
cd backend
npm run build
npm run start:prod
# 或根目录：npm run start:prod
```

### 生产环境同机托管前端

1. 将 `frontend/dist` 放到服务器某目录（如 `/var/www/massmail/frontend/dist`）。
2. 在 `backend/.env` 中设置：  
   `FRONTEND_DIR=/var/www/massmail/frontend/dist`
3. 后端会优先从该目录提供静态资源，未命中再走 API。

### 桌面安装包（Tauri）

```bash
npm run desktop:build
# 或 NSIS 安装包：npm run desktop:build:nsis
```

### 部署脚本

- `scripts/deploy-frontend.ps1`：构建前端并 SCP 到服务器、PM2 重启。
- `scripts/deploy-backend.ps1`：构建后端并 SCP 到服务器、安装依赖、PM2 重启。
- `backend/ecosystem.config.cjs.example`：PM2 配置示例（复制为 `ecosystem.config.cjs` 后 `pm2 start`）。
- `build-updater-artifacts.ps1`、`publish-updater-to-server.ps1`：Tauri 更新包构建与发布。

**完整部署与数据库说明**（首次建库、迁移、部署顺序、脚本用法）见 **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**。

## 会话交接建议

为避免 AI 会话中断后重复排查，仓库里建议固定维护两份文件：

- `docs/NEXT_SESSION_BRIEF.md`
  - 手动写“这轮完成了什么、下一步是什么、有哪些阻塞”
- `docs/CURRENT_STATUS.md`
  - 自动生成的客观状态快照

每次阶段性工作完成后，建议执行：

```bash
npm run handoff:update
```

然后下一次打开项目时，先让 AI 读取这两个文件，再继续当前任务。

## 健康与监控

- **健康**：`GET /health`、`GET /api/health` → `{ ok: true, service: "massmail-api" }`
- **指标**：`GET /metrics`（Prometheus 风格，按需启用）

## 许可证与商业化

后端文档见：`backend/README_COMMERCIALIZATION.md`、`backend/TROUBLESHOOTING.md`。
