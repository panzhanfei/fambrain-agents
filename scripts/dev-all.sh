#!/usr/bin/env bash
# 同时启动 Agent 服务 + Web BFF
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

pnpm --filter @fambrain/agents dev &
AGENTS_PID=$!
pnpm --filter @fambrain/web dev &
WEB_PID=$!

cleanup() {
  kill "$AGENTS_PID" "$WEB_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

wait "$WEB_PID"
