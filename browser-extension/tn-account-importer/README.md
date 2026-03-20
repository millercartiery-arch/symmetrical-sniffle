# TN 账户导入工具

这是一套独立浏览器扩展，用来把本地 CSV / JSON 账号数据直接导入当前项目后端，并支持导出 CSV。

## 默认连接

- 本地主项目 API：`http://localhost:3000`
- 导入接口：`POST /api/tn-accounts/import`
- 导出接口：`GET /api/v1/export`

## 支持格式

### 简版字段

`username,password,deviceId,accountId`

### 富字段

核心字段：

`phone,username,token,clientId,signature`

兼容别名：

- `token` 同时兼容 `cookie` / `Cookie`
- `signature` 同时兼容 `X-TN-Integrity-Session` / `X-PX-AUTHORIZATION`
- `password` 留空时后端会默认补成 `123456`

## 本地加载

1. 打开 Chrome / Edge 扩展管理页。
2. 开启“开发者模式”。
3. 选择“加载已解压的扩展程序”。
4. 指向本目录。

## 打包

根目录执行：

```powershell
npm run extension:build:to-desktop
```

会把已解压扩展目录和 zip 包一起放到桌面。
