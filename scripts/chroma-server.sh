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

export PATH="${HOME}/.local/bin:${PATH}"
if ! command -v uv >/dev/null 2>&1; then
  echo "未找到 uv，请先安装：https://docs.astral.sh/uv/" >&2
  exit 1
fi

echo "Chroma: path=$DATA_PATH port=$PORT"
exec uv run --with chromadb chroma run --path "$DATA_PATH" --port "$PORT"
