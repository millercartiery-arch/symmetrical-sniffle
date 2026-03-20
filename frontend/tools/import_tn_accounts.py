#!/usr/bin/env python3
"""
Desktop import helper for TN accounts.

This tool accepts JSON or JSONL input, normalizes it to JSONL, and can invoke
the repository's backend importer:

    backend/scripts/import_tn_jsonl.ts

Usage examples:

    python import_tn_accounts.py --file data/tn_accounts_full_example.json --backend-root ../../backend
    python import_tn_accounts.py --file accounts.jsonl --dry-run --backend-root ../../backend
    python import_tn_accounts.py --file accounts.json --jsonl-only --out normalized.jsonl
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any, Iterable


REQUIRED_KEYS = ("phone", "username", "token", "clientId", "signature")


def _read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8-sig")


def _load_rows(source: Path) -> list[dict[str, Any]]:
    raw = _read_text(source).strip()
    if not raw:
        raise ValueError(f"Input file is empty: {source}")

    if raw.startswith("[") or raw.startswith("{"):
        data = json.loads(raw)
        if isinstance(data, dict) and "accounts" in data and isinstance(data["accounts"], list):
            rows = data["accounts"]
        elif isinstance(data, list):
            rows = data
        elif isinstance(data, dict):
            rows = [data]
        else:
            raise ValueError("JSON input must be an array, an object with `accounts`, or a single object")
        return [row if isinstance(row, dict) else {"value": row} for row in rows]

    rows: list[dict[str, Any]] = []
    for line_no, line in enumerate(raw.splitlines(), start=1):
        line = line.strip()
        if not line:
            continue
        try:
            parsed = json.loads(line)
        except json.JSONDecodeError as exc:
            raise ValueError(f"Invalid JSON on line {line_no}: {exc.msg}") from exc
        rows.append(parsed if isinstance(parsed, dict) else {"value": parsed})
    return rows


def _pick(record: dict[str, Any], keys: Iterable[str]) -> str:
    for key in keys:
        for candidate in (key, key.lower(), key.upper()):
            if candidate in record:
                value = record[candidate]
                if value is None:
                    continue
                text = str(value).strip()
                if text:
                    return text
    return ""


def _normalize_row(record: dict[str, Any]) -> dict[str, Any]:
    return {
        "phone": _pick(record, ("phone",)),
        "email": _pick(record, ("email",)),
        "username": _pick(record, ("username",)),
        "password": _pick(record, ("password",)) or "123456",
        "token": _pick(record, ("token", "cookie", "Cookie")),
        "proxy_url": _pick(record, ("proxy_url", "proxyUrl")),
        "platform": _pick(record, ("platform",)) or "Android",
        "status": _pick(record, ("status",)) or "Ready",
        "clientId": _pick(record, ("clientId",)),
        "model": _pick(record, ("model", "X-PX-DEVICE-MODEL", "x-px-device-model")),
        "osVersion": _pick(record, ("osVersion", "X-PX-OS-VERSION", "x-px-os-version")),
        "userAgent": _pick(record, ("userAgent", "User-Agent", "user-agent")),
        "uuid": _pick(record, ("uuid", "X-PX-UUID", "x-px-uuid")),
        "vid": _pick(record, ("vid", "X-PX-VID", "x-px-vid")),
        "signature": _pick(record, ("signature", "X-TN-Integrity-Session", "x-tn-integrity-session")),
        "appVersion": _pick(record, ("appVersion", "X-PX-MOBILE-SDK-VERSION", "x-px-mobile-sdk-version")),
        "brand": _pick(record, ("brand",)),
        "language": _pick(record, ("language",)),
        "fp": _pick(record, ("fp", "X-PX-DEVICE-FP", "x-px-device-fp", "IDFV", "idfv")),
        "sessionId": _pick(record, ("sessionId",)),
    }


def _validate_row(row: dict[str, Any], index: int) -> None:
    missing = [key for key in REQUIRED_KEYS if not str(row.get(key, "")).strip()]
    if missing:
        raise ValueError(f"Account[{index}] missing required fields: {', '.join(missing)}")


def _write_jsonl(rows: list[dict[str, Any]], dest: Path) -> None:
    with dest.open("w", encoding="utf-8", newline="\n") as fh:
        for row in rows:
            fh.write(json.dumps(row, ensure_ascii=False))
            fh.write("\n")


def _detect_backend_root(explicit: str | None) -> Path | None:
    candidates: list[Path] = []
    if explicit:
        candidates.append(Path(explicit))

    script_dir = Path(__file__).resolve().parent
    candidates.extend([
        script_dir.parents[1] / "backend",
        Path.cwd() / "backend",
    ])

    for candidate in candidates:
        if (candidate / "package.json").exists() and (candidate / "scripts" / "import_tn_jsonl.ts").exists():
            return candidate
    return None


def main() -> int:
    parser = argparse.ArgumentParser(description="Normalize TN account dumps and run the backend importer")
    parser.add_argument("--file", default="data/tn_accounts_full_example.json", help="JSON or JSONL source file")
    parser.add_argument("--out", help="Write normalized JSONL to this path")
    parser.add_argument("--jsonl-only", action="store_true", help="Only write normalized JSONL and do not run the backend importer")
    parser.add_argument("--dry-run", action="store_true", help="Pass dry-run to the backend importer")
    parser.add_argument("--limit", type=int, help="Limit the number of rows processed")
    parser.add_argument("--tenant-id", help="Override TN_IMPORT_TENANT_ID for the backend importer")
    parser.add_argument("--backend-root", help="Path to the repository backend folder")
    parser.add_argument("--keep-jsonl", action="store_true", help="Keep the temporary normalized JSONL file")
    args = parser.parse_args()

    source = Path(args.file).expanduser().resolve()
    if not source.exists():
        print(f"File not found: {source}", file=sys.stderr)
        return 1

    try:
        rows = _load_rows(source)
        if args.limit is not None:
            rows = rows[: max(args.limit, 0)]
        normalized = [_normalize_row(row) for row in rows]
        for index, row in enumerate(normalized):
            _validate_row(row, index)
    except Exception as exc:
        print(f"Failed to normalize input: {exc}", file=sys.stderr)
        return 1

    output_path = Path(args.out).expanduser().resolve() if args.out else None
    temp_dir: tempfile.TemporaryDirectory[str] | None = None
    try:
        if output_path is None:
            temp_dir = tempfile.TemporaryDirectory(prefix="tn-import-")
            output_path = Path(temp_dir.name) / "accounts.normalized.jsonl"

        _write_jsonl(normalized, output_path)
        print(f"Normalized JSONL written to: {output_path}")

        if args.jsonl_only:
            return 0

        backend_root = _detect_backend_root(args.backend_root)
        if backend_root is None:
            print("Backend folder not found. Pass --backend-root or use --jsonl-only.", file=sys.stderr)
            return 2

        command = [
            "npm",
            "exec",
            "--prefix",
            str(backend_root),
            "tsx",
            "scripts/import_tn_jsonl.ts",
            str(output_path),
        ]
        if args.dry_run:
            command.append("--dry-run")
        if args.limit is not None:
            command.extend(["--limit", str(args.limit)])

        env = os.environ.copy()
        if args.tenant_id:
            env["TN_IMPORT_TENANT_ID"] = args.tenant_id

        print(f"Running backend importer in: {backend_root}")
        result = subprocess.run(command, env=env)
        return int(result.returncode)
    finally:
        if temp_dir is not None and not args.keep_jsonl and output_path is not None and output_path.exists():
            if output_path.parent == Path(temp_dir.name):
                try:
                    output_path.unlink()
                except OSError:
                    pass
            temp_dir.cleanup()


if __name__ == "__main__":
    raise SystemExit(main())
