# TN 账户导入工具

这是一个本地导入包装器，用来把 JSON 或 JSONL 格式的 TextNow 账号数据整理成后端可直接消费的 JSONL，并调用仓库里的后端导入脚本。

## 文件

- `import_tn_accounts.py`
- `../data/tn_accounts_full_example.json`

## 用法

从 `frontend/tools` 目录运行：

```bash
python import_tn_accounts.py --file ../data/tn_accounts_full_example.json --backend-root ../../backend
```

仅生成标准化 JSONL，不执行导入：

```bash
python import_tn_accounts.py --file ../data/tn_accounts_full_example.json --jsonl-only --out normalized.jsonl
```

导入时可加 `--dry-run` 只做校验：

```bash
python import_tn_accounts.py --file accounts.jsonl --dry-run --backend-root ../../backend
```

## 支持格式

- JSON 数组
- 包含 `accounts` 数组的 JSON 对象
- JSONL，每行一个账号对象

## 必填字段

后端导入前会校验这些字段：

- `phone`
- `username`
- `token`
- `clientId`
- `signature`

## 说明

- 这个工具不会再调用已下线的 `POST /api/tn-accounts/import`。
- 真正的导入执行由 `backend/scripts/import_tn_jsonl.ts` 完成。
- 如果仓库不在当前目录，请通过 `--backend-root` 指向 `backend` 目录。
