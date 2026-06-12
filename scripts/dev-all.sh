#!/usr/bin/env bash
# 一键本地开发：Chroma（uv/chromadb）+ Agent + Web
# Ollama 走 .env 的 OLLAMA_HOST / OLLAMA_BASE_URL（可指向局域网台式机）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

ENV_FILE="$ROOT/.env"
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

CHROMA_HOST="${CHROMA_HOST:-127.0.0.1}"
CHROMA_PORT="${CHROMA_PORT:-8030}"
CHROMA_URL="${CHROMA_SERVER_URL:-http://${CHROMA_HOST}:${CHROMA_PORT}}"
CHROMA_URL="${CHROMA_URL%/}"
CHROMA_WAIT_SEC="${CHROMA_WAIT_SEC:-90}"

chroma_ready() {
  curl -sf "${CHROMA_URL}/api/v2/heartbeat" >/dev/null 2>&1
}

wait_for_chroma() {
  local pid="$1"
  local i
  for i in $(seq 1 "$CHROMA_WAIT_SEC"); do
    if chroma_ready; then
      return 0
    fi
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "[dev] Chroma 进程已退出（${i}s）" >&2
      return 1
    fi
    sleep 1
  done
  return 1
}

CHROMA_PID=""
if chroma_ready; then
  echo "[dev] 复用已在运行的 Chroma (${CHROMA_URL})"
else
  echo "[dev] 正在启动 Chroma (${CHROMA_URL})，首次运行 uv 可能需下载依赖，请稍候..."
  bash "$ROOT/scripts/chroma-server.sh" &
  CHROMA_PID=$!
  if ! wait_for_chroma "$CHROMA_PID"; then
    kill "$CHROMA_PID" 2>/dev/null || true
    if ! command -v uv >/dev/null 2>&1; then
      echo "[dev] 未找到 uv，请先安装：https://docs.astral.sh/uv/" >&2
    else
      echo "[dev] Chroma 在 ${CHROMA_WAIT_SEC}s 内未就绪，可单独运行 pnpm run chroma:server 查看日志" >&2
    fi
    exit 1
  fi
  echo "[dev] Chroma 已就绪 (pid=${CHROMA_PID})"
fi

pnpm --filter @fambrain/agents dev &
AGENTS_PID=$!
pnpm --filter @fambrain/web dev &
WEB_PID=$!

cleanup() {
  kill "$AGENTS_PID" "$WEB_PID" 2>/dev/null || true
  if [[ -n "$CHROMA_PID" ]]; then
    kill "$CHROMA_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

wait "$WEB_PID"
