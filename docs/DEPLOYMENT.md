# 部署与数据库说明

本文档说明生产环境部署顺序、数据库初始化与迁移、以及部署脚本用法。

**约定**：数据库的完整配置（建库、迁移、读写用户）在**服务器**完成；本地仅需**可选的可读连接**（只读用户或只读副本），用作可读数据库视图，便于查数据与调试，不在本地执行建库与迁移。

---

## 一、数据库

### 1. 环境变量（backend/.env）

- **服务器（必填）**：在服务器上的 `backend/.env` 配置具备读写权限的 DB 用户，用于运行 API 及执行建库/迁移。
  - `DB_HOST`：MySQL 主机（本机填 `localhost`，远程填 IP 或域名）
  - `DB_PORT`：默认 `3306`
  - `DB_USER` / `DB_PASSWORD`：读写用户（如 `massmail`；建库时可用 `root`，完成后建议改为专用用户）
  - `DB_NAME`：库名，默认 `massmail`
- **本地（可选）**：若需在本地查看线上/测试库数据，可单独配置一套 `.env`（或 `.env.local`），使用**只读用户**连接服务器库或只读副本，仅作可读数据库视图，不在此执行 `db:full` / `db:ensure` / 迁移。

**本地可读数据库视图**：在服务器 MySQL 中创建仅 `SELECT` 权限的用户，例如：
```sql
CREATE USER 'massmail_ro'@'%' IDENTIFIED BY '只读密码';
GRANT SELECT ON massmail.* TO 'massmail_ro'@'%';
FLUSH PRIVILEGES;
```
本地 `.env` 使用 `DB_USER=massmail_ro` 及对应密码，连接服务器 DB 即可只读查看数据（DBeaver、CLI 或 `check:db-api` 等）；API 写操作需在服务器上用读写用户运行。

### 2. 首次初始化（在服务器上从零建库）

**方式 A：在服务器上执行完整建表脚本（推荐）**

在服务器项目目录：

```bash
cd backend
cp .env.example .env
# 编辑 .env 填写 DB_*（若用 root 可先只填 DB_PASSWORD）
npm run db:full
```

`db:full` 会读取 `backend/scripts/schema_full_create.sql`，创建 `massmail` 库及所有表（users、accounts、campaigns、message_tasks、contacts、proxies、proxy_audit、credentials、card_keys、sub_accounts 等）。

**方式 B：手动执行 SQL**

```bash
# 创建库并执行完整建表
mysql -u root -p -e "CREATE DATABASE IF NOT EXISTS massmail;"
mysql -u root -p massmail < backend/scripts/schema_full_create.sql
```

然后执行「补充表结构」步骤，确保 proxy、credentials 等由代码维护的表存在：

```bash
cd backend
npm run db:ensure
```

### 3. 已有库、仅补充/更新表结构（在服务器执行）

若库已存在且已执行过 `schema_full_create.sql`，在服务器上执行，确保 proxies、credentials、contacts 等表与代码一致：

```bash
cd backend
npm run db:ensure
# 或 npm run db:migrate（同义）
```

### 4. 可选：测试数据

```bash
cd backend
npm run seed
```

### 5. 迁移脚本（在服务器上按需执行）

增量迁移在 `backend/scripts/` 下，例如：

- `migrate_accounts_tn_columns.sql`
- `migrate_scheduler_locking.sql` / `migrate_scheduler_locking_hotfix.sql`
- `migrate_proxy_audit_fk.sql`
- `migrate-normalize-phone.js`（Node 脚本：`npm run migrate:normalize-phone`）
- `add_tenant_support.cjs`（多租户：`npm run migrate:tenant`）

执行前请先备份数据库，再在服务器上按脚本说明在对应库执行。

### 6. 验证数据库与 API（可在服务器或本地只读连接下执行）

```bash
cd backend
npm run check:db-api
```

会检查 DB 连接及健康接口 `GET /api/health`（需先启动后端）。

---

## 二、部署顺序（生产服务器）

建议顺序：

1. **服务器环境**：安装 Node 18+、MySQL 8、Redis（可选）、PM2。
2. **数据库**：在服务器或独立 DB 上按「一、数据库」完成建库与迁移。
3. **后端**：上传代码、配置 `.env`、安装依赖、构建、用 PM2 启动。
4. **前端**：构建 `frontend/dist`，放到后端可访问的目录，并配置 `FRONTEND_DIR`（若同机托管）。
5. **CORS / 域名挂载**：  
   - 若前端与 API **同域名**（如 Nginx 反代到同一后端），无需配置 CORS；后端会按请求的 `Host` / `X-Forwarded-Proto` 同域放行。  
   - 若前端与 API 不同域，在 `backend/.env` 中设置 `CORS_ORIGINS=https://前端域名` 或 `SERVER_PUBLIC_ORIGIN=https://前端域名`。  
   - 使用 Nginx 反代时请保留 `X-Forwarded-Proto`、`Host` 等头，后端已启用 `trust proxy`。

---

## 三、部署脚本

### 1. 后端 PM2 配置

```bash
cd backend
cp ecosystem.config.cjs.example ecosystem.config.cjs
# 按需改 name、script、cwd、env、日志路径
pm2 start ecosystem.config.cjs
pm2 save && pm2 startup   # 开机自启
```

### 2. 前端部署（PowerShell）

在项目根目录：

```powershell
$env:DEPLOY_HOST = "root@你的服务器"
$env:DEPLOY_PATH = "/var/www/massmail"
.\scripts\deploy-frontend.ps1
```

会执行：本机 `npm run build:frontend` → 将 `frontend/dist` 上传到服务器 `$DEPLOY_PATH/frontend/` → 在服务器执行 `pm2 restart massmail-api`（或脚本内配置的 PM2 名）。

### 3. 前端部署（Bash）

```bash
export DEPLOY_HOST=root@你的服务器
export DEPLOY_PATH=/var/www/massmail
bash scripts/deploy-frontend.sh
```

会在服务器上拉取/同步 frontend 代码并执行 `npm ci && npm run build`，再 `pm2 restart all`。

### 4. 后端部署（PowerShell）

在项目根目录：

```powershell
$env:DEPLOY_HOST = "root@你的服务器"
$env:DEPLOY_PATH = "/var/www/massmail"
.\scripts\deploy-backend.ps1
```

会执行：本机 `cd backend && npm run build` → 上传 `backend/dist`、`package.json`、`package-lock.json` → 在服务器 `backend` 目录执行 `npm install --omit=dev` 和 `pm2 restart massmail-api`。

**注意**：服务器上 `backend/.env` 需已存在并配置好 DB、JWT_SECRET、CORS、FRONTEND_DIR 等；首次部署需先在服务器创建 `$DEPLOY_PATH/backend` 并放入 `.env`，或通过其他方式配置环境变量。

---

## 四、同机托管前端

1. 将前端构建产物放到服务器目录，例如：`/var/www/massmail/frontend/dist`。
2. 在 `backend/.env` 中设置：  
   `FRONTEND_DIR=/var/www/massmail/frontend/dist`
3. 后端会先挂载 `/assets` 和该静态目录，再回退到 `index.html`，实现 SPA。
4. 确保 Nginx/反向代理（若有）将请求转发到后端端口（如 3000），或直接访问后端端口。

---

## 五、检查清单

- [ ] MySQL 已安装，`massmail` 库及表已创建（`db:full` 或手动 SQL + `db:ensure`）
- [ ] `backend/.env` 已配置：DB_*、JWT_SECRET、PORT、NODE_ENV=production、CORS_ORIGINS、FRONTEND_DIR（若同机托管）
- [ ] 后端已构建（`npm run build`）并用 PM2 启动
- [ ] 前端已构建并放到 FRONTEND_DIR 或独立 Web 服务器
- [ ] `GET /health`、`GET /api/health` 返回 200
- [ ] 前端可访问且接口请求正常（无 CORS 报错）
