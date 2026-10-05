#!/usr/bin/env bash
# 语料入库：若 Qdrant 未运行则 docker compose up，就绪后执行全量 index
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/.env"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

QDRANT_HOST="${QDRANT_HOST:-127.0.0.1}"
QDRANT_PORT="${QDRANT_PORT:-6333}"
QDRANT_URL="${QDRANT_URL:-http://${QDRANT_HOST}:${QDRANT_PORT}}"
QDRANT_URL="${QDRANT_URL%/}"

qdrant_ready() {
  curl -sf "${QDRANT_URL}/readyz" >/dev/null 2>&1
}

wait_for_qdrant() {
  local wait_sec="${QDRANT_WAIT_SEC:-60}"
  local i
  for i in $(seq 1 "$wait_sec"); do
    if qdrant_ready; then
      return 0
    fi
    sleep 1
  done
  return 1
}

if qdrant_ready; then
  echo "[index:corpus] 复用已在运行的 Qdrant (${QDRANT_URL})"
else
  if ! command -v docker >/dev/null 2>&1; then
    echo "[index:corpus] Qdrant 未就绪且未安装 Docker (${QDRANT_URL})" >&2
    exit 1
  fi
  echo "[index:corpus] Qdrant 未就绪，正在 docker compose up qdrant..."
  (cd "$ROOT" && docker compose up -d qdrant)
  if ! wait_for_qdrant; then
    echo "[index:corpus] Qdrant 启动超时 (${QDRANT_URL})" >&2
    exit 1
  fi
  echo "[index:corpus] Qdrant 已就绪 (${QDRANT_URL})"
fi

cd "$ROOT"
exec uv run --directory "$ROOT/apps/brain" python scripts/index_corpus.py
