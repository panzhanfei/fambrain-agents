#!/usr/bin/env bash
# 一键本地开发：Qdrant + Redis（可选）+ Agent [+ Worker] + Web
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
QDRANT_HOST="${QDRANT_HOST:-127.0.0.1}"
QDRANT_PORT="${QDRANT_PORT:-6333}"
QDRANT_URL="${QDRANT_URL:-http://${QDRANT_HOST}:${QDRANT_PORT}}"
QDRANT_URL="${QDRANT_URL%/}"
QDRANT_WAIT_SEC="${QDRANT_WAIT_SEC:-60}"
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

qdrant_ready() {
  curl -sf "${QDRANT_URL}/readyz" >/dev/null 2>&1
}

wait_for_qdrant() {
  local i
  for i in $(seq 1 "$QDRANT_WAIT_SEC"); do
    if qdrant_ready; then
      return 0
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

# --- Qdrant（语料 dense+sparse + Mem0 dense）---
if qdrant_ready; then
  echo "[dev] 复用已在运行的 Qdrant (${QDRANT_URL})"
else
  if ! command -v docker >/dev/null 2>&1; then
    echo "[dev] Qdrant 未就绪且未安装 Docker (${QDRANT_URL})" >&2
    exit 1
  fi
  echo "[dev] 正在通过 Docker 启动 Qdrant (${QDRANT_URL})..."
  docker compose up -d qdrant
  if ! wait_for_qdrant; then
    echo "[dev] Qdrant 在 ${QDRANT_WAIT_SEC}s 内未就绪" >&2
    exit 1
  fi
  echo "[dev] Qdrant 已就绪 (docker compose)"
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
(cd "$ROOT/apps/brain" && uv run fambrain-api) &
BRAIN_SERVICE_PID=$!

WORKER_PID=""

pnpm --filter @fambrain/web dev &
WEB_PID=$!

echo ""
echo "[dev] ── FamBrain 本地开发 ──"
echo "  Web:    http://127.0.0.1:${PORT}"
echo "  Brain:  http://127.0.0.1:${BRAIN_SERVICE_PORT}"
echo "  Qdrant: ${QDRANT_URL}"
if [[ "$REDIS_STATUS" -ne 2 ]]; then
  echo "  Redis:  ${REDIS_HOST}:${REDIS_PORT} (db=${REDIS_DB:-0})"
fi
echo "  Ollama: ${OLLAMA_URL}"
echo "[dev] Ctrl+C 停止 Web / Brain${WORKER_PID:+ / Worker}"
echo ""

cleanup() {
  kill "$BRAIN_SERVICE_PID" "$WEB_PID" 2>/dev/null || true
  if [[ -n "$WORKER_PID" ]]; then
    kill "$WORKER_PID" 2>/dev/null || true
  fi
  if [[ "$REDIS_STARTED_BY_DEV" -eq 1 ]]; then
    docker compose stop redis >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

wait "$WEB_PID"
