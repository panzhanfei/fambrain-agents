#!/usr/bin/env bash
# 从仓库根 .env 读取 CHROMA_PORT，启动本地 Chroma HTTP 服务
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/.env"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

PORT="${CHROMA_PORT:-8030}"
DATA_PATH="$ROOT/data/chroma"

echo "Chroma: path=$DATA_PATH port=$PORT"
exec uv run --with chromadb chroma run --path "$DATA_PATH" --port "$PORT"
