# 域名能打开但没有 UI 画面

访问 https://hkd.llc 有响应，但页面空白、没有登录/看板等界面时，按下面顺序排查。

---

## 1. 浏览器里先看这两项（必做）

打开 https://hkd.llc，按 **F12**：

### Network（网络）

- 勾选 **「禁用缓存」**，再刷新页面。
- 看 **`index.html`**：状态码是否为 **200**？
- 看 **`/assets/xxx.js`、`/assets/xxx.css`**：是 **200** 还是 **404**？  
  - 若是 **404**：说明静态资源没被正确提供，按第 2 步处理。  
  - 若是 **200**：点开某个 `.js` 请求，看 **响应头** 里 **Content-Type** 是否为 **`application/javascript`**（或类似）。  
  - 若是 **`text/html`**：说明请求被当成页面回了 index.html（MIME 错误），按第 2 步更新后端。

### Console（控制台）

- 是否有**红色报错**？  
  - 若有 **Failed to load module script... MIME type "text/html"**：同上是静态资源被当 HTML 返回，按第 2 步。  
  - 若有 **CORS、Failed to fetch、404**：多半是接口地址或跨域问题，看第 3 步。  
  - 若有 **Uncaught TypeError** 等：把完整报错贴出来再查。

---

## 2. 确保服务器上是「新前端 + 新后端」

### 2.1 前端（必须包含正确 index.html 和 assets）

- **本机** 已用当前代码构建：  
  `npm run build:frontend`  
  得到 `frontend/dist`（内有 `index.html` 和 `assets/` 下若干 .js/.css）。
- 把 **整份 `frontend/dist`** 上传并覆盖到服务器：  
  **`/var/www/massmail/frontend/dist/`**  
  （不要只传 index.html，必须带 `assets` 文件夹。）

这样可保证：
- `index.html` 里有 `<div id="root">` 和入口脚本；
- 页面引用的 `/assets/xxx.js` 在服务器上真实存在。

### 2.2 后端（必须能正确提供 /assets 和前端目录）

- **本机** 已构建：  
  `npm run build:backend`  
  得到 `backend/dist`。
- 把 **`backend/dist` 里全部文件** 上传并覆盖到服务器：  
  **`/var/www/massmail/backend/dist/`**  
  确保服务器上的后端代码包含：
  - 先挂载 **`/assets`** 的静态中间件；
  - 支持 **`FRONTEND_DIR`** 环境变量。

在服务器上用 **ecosystem 启动**（带上前端目录），避免 FRONTEND_DIR 未生效：

```bash
cd /var/www/massmail/backend
pm2 delete massmail-api 2>/dev/null
pm2 start ecosystem.config.cjs
pm2 save
```

确认日志里有：  
**`[massmail-api] serving frontend from FRONTEND_DIR env: /var/www/massmail/frontend/dist`**  
或 **`serving frontend from /var/www/massmail/frontend/dist`**。

---

## 3. 接口地址与跨域

- 前端生产包是用 **`frontend/.env.production`** 里 **`VITE_API_BASE_URL=https://hkd.llc/api`** 打的，一般不会错。
- 若你改过域名或端口，需要改 `.env.production` 后**重新** `npm run build:frontend`，再重新上传 **`frontend/dist`**。
- 若 Console 报 CORS：检查后端 CORS 配置里是否允许 **https://hkd.llc**（或你的实际域名）。

---

## 4. 快速自检命令（服务器上）

```bash
# 前端目录是否存在且含 index 和 assets
ls -la /var/www/massmail/frontend/dist/
ls /var/www/massmail/frontend/dist/assets/ | head -3

# 后端是否包含 /assets 和 FRONTEND_DIR 逻辑
grep -l "FRONTEND_DIR\|/assets" /var/www/massmail/backend/dist/index.js
```

---

## 5. 总结

| 现象 | 处理 |
|------|------|
| `/assets/xxx.js` 404 | 上传完整 **frontend/dist**（含 assets）到 `/var/www/massmail/frontend/dist`。 |
| `/assets/xxx.js` 返回 HTML（MIME 错误） | 部署**新后端**（含先挂载 `/assets` 的代码），并用 **ecosystem.config.cjs** 启动，保证 FRONTEND_DIR 正确。 |
| 静态都 200 仍白屏 | 看 Console 报错；检查 **VITE_API_BASE_URL** 与后端 CORS。 |

按上面做完后，**强刷**（Ctrl+F5）或**无痕/隐私模式**再开 https://hkd.llc 试一次。
