# 部署到服务器 — 执行清单

按顺序执行即可开始部署。将 `你的服务器`、`/var/www/massmail` 替换为实际主机与路径。

---

## 第一步：服务器环境（SSH 登录服务器执行）

```bash
# 安装 Node 18+（若无）
# 安装 MySQL 8、Redis（可选）、PM2
npm install -g pm2
```

创建部署目录：

```bash
mkdir -p /var/www/massmail/backend
mkdir -p /var/www/massmail/frontend
```

---

## 第二步：数据库（在服务器上完成）

在服务器 MySQL 中建库建表（二选一）。

**方式 A：在服务器项目目录用 Node 执行**

```bash
cd /var/www/massmail/backend
# 先将 backend 代码放到此目录（见第三步），并配置 .env 后执行：
npm run db:full
npm run db:ensure
```

**方式 B：用 MySQL 命令行**

```bash
mysql -u root -p -e "CREATE DATABASE IF NOT EXISTS massmail;"
mysql -u root -p massmail < /path/to/backend/scripts/schema_full_create.sql
# 然后同样在 backend 目录执行：npm run db:ensure
```

---

## 第三步：后端 .env（服务器上）

在服务器创建 `/var/www/massmail/backend/.env`，内容参考 `backend/.env.example`，必填：

- `DB_HOST`、`DB_PORT`、`DB_USER`、`DB_PASSWORD`、`DB_NAME`
- `PORT=3000`
- `NODE_ENV=production`
- `JWT_SECRET=`（至少 32 位随机串）
- `CORS_ORIGINS=https://你的前端域名` 或 `http://服务器IP:8080`（按实际访问方式）
- `FRONTEND_DIR=/var/www/massmail/frontend/dist`（同机托管前端时必填）

可通过本机 SCP 上传示例后改名为 `.env` 再编辑：

```powershell
scp backend\.env.example  root@你的服务器:/var/www/massmail/backend/.env
ssh root@你的服务器 "nano /var/www/massmail/backend/.env"
```

---

## 第四步：首次部署后端（本机 PowerShell，项目根目录）

```powershell
$env:DEPLOY_HOST = "root@你的服务器"
$env:DEPLOY_PATH = "/var/www/massmail"
.\scripts\deploy-backend.ps1
```

若服务器上还没有 `backend` 代码（只有 .env），需先上传整份 backend（或至少 `package.json`、`package-lock.json`、`dist`）。部署脚本会上传 `dist` + package 文件并在服务器执行 `npm install --omit=dev`，因此**首次**可能需先手动上传完整 backend 目录一次，或先 clone 项目到服务器再执行 deploy-backend。

**首次无 backend 代码时**，可在服务器执行：

```bash
# 在服务器上
cd /var/www/massmail
git clone <你的仓库> . --depth 1
# 或本机 scp -r backend/* root@服务器:/var/www/massmail/backend/
cd backend
npm install --omit=dev
npm run build
cp ecosystem.config.cjs.example ecosystem.config.cjs
pm2 start ecosystem.config.cjs
pm2 save && pm2 startup
```

之后日常更新只需本机执行 `.\scripts\deploy-backend.ps1` 即可。

---

## 第五步：部署前端（本机 PowerShell，项目根目录）

```powershell
$env:DEPLOY_HOST = "root@你的服务器"
$env:DEPLOY_PATH = "/var/www/massmail"
.\scripts\deploy-frontend.ps1
```

脚本会：本机构建前端 → 上传 `frontend/dist` 到服务器 `$DEPLOY_PATH/frontend/` → 执行 `pm2 restart massmail-api`。

确保 `frontend/.env.production`（或构建时使用的环境变量）中 `VITE_API_BASE_URL`、`VITE_SOCKET_BASE_URL` 指向服务器 API（如 `https://你的域名` 或 `http://服务器IP:3000`）。

---

## 第六步：验证

- 健康检查：`curl http://你的服务器:3000/health` 或 `curl http://你的服务器:3000/api/health`，应返回 `{"ok":true,"service":"massmail-api"}`。
- 前端：浏览器访问后端同机托管时的根地址（如 `http://服务器IP:3000`）或你配置的 Nginx 域名，应打开登录页并可正常请求接口。

---

## 日常更新（本机）

```powershell
$env:DEPLOY_HOST = "root@你的服务器"
$env:DEPLOY_PATH = "/var/www/massmail"
.\scripts\deploy-backend.ps1
.\scripts\deploy-frontend.ps1
```

按需只执行其一即可。
