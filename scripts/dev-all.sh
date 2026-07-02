#!/usr/bin/env bash
# 一键本地开发：Chroma + Redis（可选）+ Agent [+ Worker] + Web
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

PORT="${PORT:-3000}"
BRAIN_SERVICE_PORT="${BRAIN_SERVICE_PORT:-3001}"
CHROMA_HOST="${CHROMA_HOST:-127.0.0.1}"
CHROMA_PORT="${CHROMA_PORT:-8030}"
CHROMA_URL="${CHROMA_SERVER_URL:-http://${CHROMA_HOST}:${CHROMA_PORT}}"
CHROMA_URL="${CHROMA_URL%/}"
CHROMA_WAIT_SEC="${CHROMA_WAIT_SEC:-90}"
REDIS_HOST="${REDIS_HOST:-127.0.0.1}"
REDIS_PORT="${REDIS_PORT:-6379}"
REDIS_WAIT_SEC="${REDIS_WAIT_SEC:-30}"
# 1=ping 失败且端口空闲时 docker compose up redis
DEV_REDIS_AUTO_START="${DEV_REDIS_AUTO_START:-1}"
OLLAMA_URL="${OLLAMA_BASE_URL:-http://${OLLAMA_HOST:-127.0.0.1}:${OLLAMA_PORT:-11434}}"
OLLAMA_URL="${OLLAMA_URL%/}"

truthy() {
  case "${1:-}" in 1|true|yes|TRUE|YES) return 0 ;; *) return 1 ;; esac
}

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
    if [[ -n "$pid" ]] && ! kill -0 "$pid" 2>/dev/null; then
      echo "[dev] Chroma 进程已退出（${i}s）" >&2
      return 1
    fi
    sleep 1
  done
  return 1
}

port_open() {
  nc -z "$1" "$2" 2>/dev/null
}

redis_ping() {
  pnpm exec tsx --env-file="$ENV_FILE" "$ROOT/scripts/redis-ping.ts" >/dev/null 2>&1
  return $?
}

wait_for_redis() {
  local i
  for i in $(seq 1 "$REDIS_WAIT_SEC"); do
    if redis_ping; then
      return 0
    fi
    sleep 1
  done
  return 1
}

ollama_ready() {
  curl -sf "${OLLAMA_URL}/api/tags" >/dev/null 2>&1
}

# --- Prisma Client（首次 clone 后缺生成物会报错）---
if [[ ! -f "$ROOT/packages/db/src/generated/prisma/index.js" ]]; then
  echo "[dev] 未找到 Prisma Client，正在 db:generate..."
  pnpm run db:generate
fi

# --- Chroma ---
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

# --- Redis（REDIS_URL 或 REDIS_ENABLED=1 时启用；否则 memory fallback）---
REDIS_STARTED_BY_DEV=0
set +e
redis_ping
REDIS_STATUS=$?
set -e

if [[ "$REDIS_STATUS" -eq 2 ]]; then
  echo "[dev] Redis 未启用（REDIS_ENABLED≠1 且无 REDIS_URL）→ 检索 cache 用进程内 memory"
elif [[ "$REDIS_STATUS" -eq 0 ]]; then
  echo "[dev] 复用已在运行的 Redis (${REDIS_HOST}:${REDIS_PORT})"
else
  if port_open "$REDIS_HOST" "$REDIS_PORT"; then
    echo "[dev] Redis ${REDIS_HOST}:${REDIS_PORT} 有进程监听但 PING 失败" >&2
    echo "[dev] 请检查 REDIS_URL 密码、REDIS_DB，或改用无密本地实例（可设 DEV_REDIS_AUTO_START=1 由 Docker 拉起）" >&2
    exit 1
  fi
  if truthy "$DEV_REDIS_AUTO_START" && command -v docker >/dev/null 2>&1; then
    echo "[dev] 正在通过 Docker 启动 Redis (${REDIS_HOST}:${REDIS_PORT})..."
    docker compose up -d redis
    REDIS_STARTED_BY_DEV=1
    if ! wait_for_redis; then
      echo "[dev] Redis 在 ${REDIS_WAIT_SEC}s 内未就绪" >&2
      exit 1
    fi
    echo "[dev] Redis 已就绪 (docker compose)"
  else
    echo "[dev] Redis 不可达。可选：" >&2
    echo "  · 安装 Docker 后重试（默认 DEV_REDIS_AUTO_START=1 会自动 docker compose up redis）" >&2
    echo "  · 或本机 redis-server / brew services start redis" >&2
    echo "  · 或设 REDIS_ENABLED=0 关闭 Redis（memory fallback）" >&2
    exit 1
  fi
fi

# --- Ollama（仅探测，不阻塞）---
if ollama_ready; then
  echo "[dev] Ollama 可访问 (${OLLAMA_URL})"
else
  echo "[dev] 警告：Ollama 暂不可达 (${OLLAMA_URL})，聊天/embed 会失败直到 Ollama 可用" >&2
fi

# --- 应用进程 ---
pnpm --filter @fambrain/brain-service dev &
BRAIN_SERVICE_PID=$!

WORKER_PID=""
if truthy "${PIPELINE_QUEUE_ENABLED:-0}"; then
  echo "[dev] PIPELINE_QUEUE_ENABLED=1 → 启动 BullMQ worker"
  pnpm --filter @fambrain/brain-service dev:worker &
  WORKER_PID=$!
fi

pnpm --filter @fambrain/web dev &
WEB_PID=$!

echo ""
echo "[dev] ── FamBrain 本地开发 ──"
echo "  Web:    http://127.0.0.1:${PORT}"
echo "  Brain:  http://127.0.0.1:${BRAIN_SERVICE_PORT}"
echo "  Chroma: ${CHROMA_URL}"
if [[ "$REDIS_STATUS" -ne 2 ]]; then
  echo "  Redis:  ${REDIS_HOST}:${REDIS_PORT} (db=${REDIS_DB:-0})"
fi
echo "  Ollama: ${OLLAMA_URL}"
echo "[dev] Ctrl+C 停止 Web / Brain${WORKER_PID:+ / Worker}${CHROMA_PID:+ / Chroma}"
echo ""

cleanup() {
  kill "$BRAIN_SERVICE_PID" "$WEB_PID" 2>/dev/null || true
  if [[ -n "$WORKER_PID" ]]; then
    kill "$WORKER_PID" 2>/dev/null || true
  fi
  if [[ -n "$CHROMA_PID" ]]; then
    kill "$CHROMA_PID" 2>/dev/null || true
  fi
  if [[ "$REDIS_STARTED_BY_DEV" -eq 1 ]]; then
    docker compose stop redis >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

wait "$WEB_PID"
