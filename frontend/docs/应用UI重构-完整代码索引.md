# 应用 UI 重构 - 完整代码索引

本文档汇总**与应用 UI 重构相关的所有前端代码**的文件路径与职责，便于归档或在新项目中复用。具体实现以仓库内文件为准，此处仅作索引与关键片段摘录。

---

## 一、目录结构总览

```
frontend/src/
├── main.tsx                    # 入口：ThemeProvider、ConfigProvider、i18n、Tauri、错误边界
├── App.tsx                     # 根组件：路由、主题注入、全局壳（TitleBar/UpdatePrompt/PrivacyModal）
├── context/
│   └── ThemeContext.tsx        # 主题/品牌色 Context（light|dark|high-contrast + brandColor）
├── layouts/
│   └── AdminLayout.tsx         # 管理端布局：侧栏、Header、新建任务、个人中心抽屉
├── components/
│   ├── DesktopTitleBar.tsx     # Tauri 标题栏（拖拽、最小化/关闭、品牌色）
│   ├── DesktopTitleBar.css
│   ├── PrivacyModal.tsx        # 隐私同意弹窗（Cookie + 后端 /privacy/status）
│   ├── UpdatePromptModal.tsx   # 应用更新提示
│   ├── WorkTaskCreateModal.tsx # Header「新建任务」打开的创建任务抽屉
│   ├── ProtectedRoute.tsx      # 鉴权包装（allowedRoles）
│   └── Dashboard/
│       ├── StatsPanel.tsx      # 统计卡（task/account/chat 三种展示）
│       └── GlobalSignalPanel.tsx # 系统概况（紧凑/完整视图）
├── pages/
│   ├── Login.tsx               # 登录页（验证码、主题切换、语言）
│   ├── Dashboard.tsx           # 看板页（GlobalSignalPanel + 三块 StatsPanel）
│   ├── AccountManager/
│   │   ├── index.tsx           # 账号管理（子账号/代理池/账号列表 Tab）
│   │   └── components/         # AccountsTab、SubAccountsTab、ProxyPoolTab、ExportFieldsModal、AccountConfigDrawer...
│   ├── Chat.tsx                # 会话/消息页
│   ├── TaskList.tsx            # 任务列表页
│   ├── Settings.tsx            # 设置（懒加载进 AdminLayout 抽屉）
│   └── Profile.tsx             # 个人中心（懒加载进 AdminLayout 抽屉）
├── hooks/
│   └── useDashboardStats.ts    # 看板数据拉取与轮询（/dashboard/stats）
├── types/
│   └── dashboard.ts            # DashboardStats、DashboardStatsResponse
├── styles/
│   ├── global.css              # 基础全局样式
│   ├── theme.css               # 主题变量
│   └── global-polish.css       # Modal/选择态/卡片/按钮/表格/聊天/抽屉等 UI 打磨
├── api.ts                      # axios 实例、baseURL、拦截器、JWT
├── i18n.ts                     # react-i18next 配置
└── utils/
    ├── jwt-auth.ts             # 登录态、角色
    ├── tenantScope.ts          # 租户 scope（会话/消息）
    └── analytics.ts            # 页面浏览打点
```

---

## 二、入口与全局

### 1. `main.tsx`

- 使用 **ThemeProvider** 包裹应用，再包 **BrowserRouter**、**App**。
- **ConfigProvider**（antd）在 ThemeProvider 外层，提供 locale（zhCN）、默认 token（colorPrimary、borderRadius 等）。
- 加载样式：`antd/dist/reset.css`、`global.css`、`theme.css`、`DesktopTitleBar.css`。
- 初始化 i18n、Tauri（若在桌面环境）、错误边界 **AppErrorBoundary**。
- 启动超时兜底（约 12s 未渲染则强制渲染），失败时在 root 内展示错误信息与「重新加载」按钮。

### 2. `App.tsx`

- 从 **ThemeContext** 读取 `theme`、`brandColor`，生成 **ConfigProvider** 的 `theme`（algorithm + token），实现亮/暗主题与品牌色。
- 路由：`/login` → Login；`/` → 重定向到 `defaultRoute`（已登录 `/admin/accounts`，未登录 `/login`）；`/admin/*` 走 **ProtectedRoute** + **AdminLayout**，子路由 dashboard、accounts、conversations、tasks、settings、profile。
- 全局 UI：已登录时渲染 **DesktopTitleBar**、**UpdatePromptModal**；始终渲染 **PrivacyModal**。
- 懒加载页面：Login、Dashboard、Chat、AccountManager、TaskList、Settings、Profile、NotFound；**Suspense** fallback 为 Spin。

### 3. `context/ThemeContext.tsx`

- **Theme** 类型：`'light' | 'dark' | 'high-contrast'`。
- **ThemeProvider**：`theme`、`setTheme`、`brandColor`、`setBrandColor`；从 localStorage 初始化，写入 `data-theme`、`--brand-color`、`lang`/`dir`（跟随 i18n）。
- **useTheme()**：消费 Context，必须在 Provider 内使用。

---

## 三、布局与壳

### 4. `layouts/AdminLayout.tsx`

- **Layout**：左侧 **Sider**（可折叠，xl 以上展开）+ 右侧 **Header** + **Content**（`<Outlet />`）。
- **Sider**：LOGO（CM）、**Menu**（dashboard、accounts、conversations、tasks），选中 key 由 pathname 前三级决定。
- **Header**：标题 Cartier&Miller、语言切换 Dropdown、**「新建任务」** 按钮（打开 WorkTaskCreateModal）、用户 Avatar Dropdown（个人中心 / 退出）。
- **个人中心**：Drawer 内 Tabs（Profile、Settings），懒加载对应页面；`destroyOnClose`、关闭后焦点回到 Avatar。
- **useLogout**：clearAuth + message + `navigate('/login', { replace: true })`。
- 样式：minHeight 扣掉 34px（为桌面标题栏留空）、token 控制边框与背景、响应式 padding/宽度。

### 5. `components/DesktopTitleBar.tsx` + `DesktopTitleBar.css`

- **DesktopTitleBar**：仅在 **Tauri** 环境渲染；props：`title`、`brandColor`（覆盖 ThemeContext）。
- 通过 **CSS 变量 `--brand-color`** 控制背景色；拖拽区域 `data-tauri-drag-region`，双击最大化。
- 按钮：最小化、关闭；快捷键 Ctrl+M / Ctrl+Shift+M / Alt+F4。
- **DesktopTitleBar.css**：固定顶部、高度 34px、`var(--brand-color, #10a37f)`；`body.tauri-desktop { padding-top: 34px }`。

---

## 四、登录与隐私

### 6. `pages/Login.tsx`

- 状态：username、password、captcha、rememberPassword、showPassword、loading、error。
- 顶部栏：语言切换（中/英）、主题切换（亮/暗）。
- 表单：账号、密码（显隐）、验证码（点击刷新）、记住密码、错误文案、登录按钮。
- **handleLogin**：校验 → `axios.post(apiUrl('/login'), { username, password })` → setAuthToken → `navigate('/admin/accounts', { replace: true })`；失败清 token、设 error、刷新验证码。

### 7. `components/PrivacyModal.tsx`

- 无 cookie `privacy_consent` 时显示 Modal；**setPrivacyCookie** / **getPrivacyCookie**（encode/decode、SameSite/Secure、6 个月）。
- 按钮：**同意并继续** → handleDecision('accepted')；**了解更多** → 打开 /privacy-policy；**不出售我的信息** → handleDecision('rejected') + 打开 /privacy/do-not-sell。
- **postDecision**：`api.post('/privacy/status', { status })`，失败用 `message.error` + i18n。
- 使用 antd **theme.useToken()**、i18n `t('key', { defaultValue })`、ARIA、统一按钮样式。

---

## 五、看板（Dashboard）

### 8. `types/dashboard.ts`

- **DashboardStats**：totalTasks、runningTasks、completionRate、failedTasks、totalAccounts、onlineAccounts、cooldownAccounts、deadAccounts、todaySent、todayFailed、system（lastUpdate、healthy）。
- **DashboardStatsResponse**：与后端一致，含 `task`（total、inProgress、completed、failed 等）、`account`（total、online、offline、cooldown、todaySent、todayFailed）。

### 9. `hooks/useDashboardStats.ts`

- **mapResponse**：将后端 `task`/`account` 转成 **DashboardStats**（含 completionRate、system）。
- **useDashboardStats(intervalMs)**：请求 `GET /dashboard/stats`，轮询、Abort 清理；返回 `{ data, loading, error, refresh }`。

### 10. `components/Dashboard/StatsPanel.tsx`

- Props：**type**（task | account | chat）、**stats**、**loading**、**error**。
- 按 type 渲染不同 **Statistic** 组合（图标、t()、safe 数字）；loading 用 Skeleton，error 用 Alert；**memo** 导出。

### 11. `components/Dashboard/GlobalSignalPanel.tsx`

- **compact**：true 时一行 Badge（在线/冷却/死亡/今日发送）+ 刷新；false 时 Card + 账户概览 + 任务概览 + 系统状态（system.healthy/lastUpdate）。
- 内部 **useDashboardStats(30_000)**；使用 **theme.useToken()** 做颜色；**memo** 导出。

### 12. `pages/Dashboard.tsx`

- 使用 **useDashboardStats(30_000)**，将 data/loading/error 传给三块 **StatsPanel**（task、account、chat）。
- 顶部 Card 内 **GlobalSignalPanel compact={false}**；底部 Divider + 说明文案（30 秒刷新）。

---

## 六、全局样式

### 13. `styles/global-polish.css`

- **Modal**：max-height 90vh、圆角、header/body/footer 内边距。
- **选择态**：`.selection-red/yellow/green/blue` 及 `::before` 顶部条（U 形边框）。
- **表格行**：hover 位移、按 selection 类名区分 hover 背景色。
- **卡片/按钮**：圆角、hover 阴影、按钮 active 缩放。
- **侧栏菜单**：`.app-sider-menu` 圆角、hover/selected 背景色、图标居中。
- **聊天**：`.chat-filter`、`.chat-tabs`、`.conversation-card`、`.sidebar-card`、`.header-area` 等。
- **布局**：`.ant-layout-content`、`.main-container` 内边距与宽度。
- **任务格式 Tabs**、**表单**、**统计颜色**（stat-online/cooldown/dead/sent）、**Badge 动画**、**Skeleton**、**Tag 状态色**、**Progress**、**Drawer**、**Confirm Modal**、响应式等。

---

## 七、其他与 UI 重构强相关文件

| 文件 | 说明 |
|------|------|
| `components/WorkTaskCreateModal.tsx` | Header「新建任务」抽屉：账号选择、号码、间隔、消息类型（文本/图/音/视）、发送模式、提交到 `/user/campaigns`。 |
| `components/ProtectedRoute.tsx` | 根据 JWT 与 allowedRoles 决定是否渲染 children，否则重定向登录。 |
| `components/UpdatePromptModal.tsx` | 检测更新并提示用户刷新或下载。 |
| `pages/AccountManager/index.tsx` | 账号管理页：Tab（子账号/代理池/账号列表）、分页、筛选、ExportFieldsModal、AccountConfigDrawer。 |
| `pages/AccountManager/components/AccountsTab.tsx` | 账号列表 Tab、工具栏、多选、状态标签等。 |
| `pages/Chat.tsx` | 会话列表 + 消息区、租户 scope、请求 /conversations、/messages。 |
| `pages/TaskList.tsx` | 任务列表、useFetchTasks、状态映射、分页。 |
| `api.ts` | baseURL（VITE_API_BASE_URL）、请求/响应拦截器（JWT、错误统一提示）。 |
| `utils/jwt-auth.ts` | getAuthToken、setAuthToken、clearAuth、isAuthenticated、getUserRole。 |
| `utils/tenantScope.ts` | readTenantScopeObject、writeTenantScope、toTenantParams（含 conversationId）。 |

---

## 八、路由与菜单对应关系

| 路径 | 组件 | 菜单 key |
|------|------|----------|
| `/login` | Login | — |
| `/admin/dashboard` | Dashboard | /admin/dashboard |
| `/admin/accounts` | AccountManager | /admin/accounts |
| `/admin/conversations` | Chat | /admin/conversations |
| `/admin/tasks` | TaskList | /admin/tasks |
| `/admin/settings` | Settings（抽屉内） | — |
| `/admin/profile` | Profile（抽屉内） | — |

默认重定向：已登录 → `/admin/accounts`，未登录 → `/login`。

---

## 九、主题与品牌色链路

1. **ThemeContext**：`theme`、`brandColor` 存 localStorage，写 `data-theme`、`--brand-color`。
2. **App.tsx**：`useTheme()` 取 theme/brandColor，传入 ConfigProvider 的 `algorithm`（暗/亮）和 `token.colorPrimary`/`colorLink`。
3. **DesktopTitleBar**：通过 `--brand-color`（prop 或 ThemeContext）设置标题栏背景。
4. **global-polish.css**：部分处使用 `#10a37f`、`rgba(16, 163, 127, …)` 与品牌色一致。

以上即为本次**应用 UI 重构所涉及的全部代码与结构**；具体实现以仓库内各文件为准，本索引便于整体查阅与迁移。
