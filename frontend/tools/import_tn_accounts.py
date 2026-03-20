"""
导入工具：向服务器 POST /api/tn-accounts/import 发送账号列表（JSON）。

与服务器接口适配说明：
- 请求：POST，Content-Type: application/json，Body: {"accounts": [{...}, ...]}
- 当前服务端该接口已下线，会返回 HTTP 404 及 JSON：{ "error": "Import API has been discontinued. ..." }
- 验证对齐：运行本脚本后若得到 404 且 body 中含上述说明，即表示与服务器行为一致。
- 校验服务器时请用 --api 指定地址，例如：--api https://你的域名/api/tn-accounts/import
"""
import argparse
import json
import sys
from urllib import request, error


def post_json(url: str, payload: dict):
    data = json.dumps(payload).encode("utf-8")
    req = request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with request.urlopen(req, timeout=20) as resp:
            body = resp.read().decode("utf-8", errors="replace")
            return resp.status, body
    except error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        return e.code, body
    except OSError as e:
        return None, f"连接失败: {e}"


def main():
    parser = argparse.ArgumentParser(description="Import TN accounts with full fields")
    parser.add_argument(
        "--file",
        default="data/tn_accounts_full_example.json",
        help="JSON file path containing an array of accounts",
    )
    parser.add_argument(
        "--api",
        default="http://localhost:3000/api/tn-accounts/import",
        help="Import endpoint URL (deprecated: API returns 404; use backend CLI or direct DB for bulk import)",
    )
    args = parser.parse_args()

    try:
        with open(args.file, "r", encoding="utf-8-sig") as f:
            accounts = json.load(f)
    except Exception as ex:
        print(f"Failed to read JSON file: {ex}")
        sys.exit(1)

    if not isinstance(accounts, list) or not accounts:
        print("JSON must be a non-empty array of account objects")
        sys.exit(1)

    required = ["phone", "username", "password", "token", "clientId", "signature"]
    for idx, acc in enumerate(accounts):
        missing = [k for k in required if not str(acc.get(k, "")).strip()]
        if missing:
            print(f"Account[{idx}] missing required fields: {','.join(missing)}")
            sys.exit(1)

    status, body = post_json(args.api, {"accounts": accounts})
    if status is None:
        print(body)
        print("提示：请确认后端已启动或 --api 指向的服务器地址正确。")
        sys.exit(1)
    print(f"HTTP {status}")
    print(body)
    if status == 404:
        try:
            msg = json.loads(body)
            if msg.get("error", "").find("discontinued") != -1:
                print("\n[适配结果] 与服务器一致：接口已下线，返回 404 为预期。")
        except Exception:
            pass


if __name__ == "__main__":
    main()
