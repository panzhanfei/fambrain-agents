#!/usr/bin/env bash
# 语料入库：若 Chroma 未运行则后台启动，就绪后执行全量 index
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
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

chroma_ready() {
  curl -sf "${CHROMA_URL}/api/v2/heartbeat" >/dev/null 2>&1
}

wait_for_chroma() {
  local pid="${1:-}"
  local wait_sec="${CHROMA_WAIT_SEC:-90}"
  local i
  for i in $(seq 1 "$wait_sec"); do
    if chroma_ready; then
      return 0
    fi
    if [[ -n "$pid" ]] && ! kill -0 "$pid" 2>/dev/null; then
      return 1
    fi
    sleep 1
  done
  return 1
}

if chroma_ready; then
  echo "[index:corpus] 复用已在运行的 Chroma (${CHROMA_URL})"
else
  echo "[index:corpus] Chroma 未就绪，正在启动..."
  bash "$ROOT/scripts/chroma-server.sh" &
  chroma_pid=$!

  if ! wait_for_chroma "$chroma_pid"; then
    kill "$chroma_pid" 2>/dev/null || true
    echo "[index:corpus] Chroma 启动超时 (${CHROMA_URL})" >&2
    exit 1
  fi

  echo "[index:corpus] Chroma 已就绪 (pid=${chroma_pid})，入库结束后仍保持运行"
fi

cd "$ROOT"
exec pnpm --filter @fambrain/brain-service index:corpus
