#!/usr/bin/env bash
set -euo pipefail

echo "[desktop] install deps"
npm ci

echo "[desktop] run regression tests"
npm run test:scheduler-components
npm run test:subaccount-distribution-smoke

echo "[desktop] build tauri installers"
npm run desktop:build

echo "[desktop] done"
