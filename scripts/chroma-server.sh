#!/usr/bin/env bash
# 从仓库根 .env 读取 CHROMA_PORT，启动本地 Chroma HTTP 服务
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/.env"
CHROMA_PY="$ROOT/tools/chroma-server"

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

if [[ ! -x "$CHROMA_PY/.venv/bin/chroma" ]]; then
  echo "Chroma: 首次安装 Python 依赖（uv sync，仅需一次，写入 tools/chroma-server/.venv）..."
  (cd "$CHROMA_PY" && uv sync)
fi

echo "Chroma: path=$DATA_PATH port=$PORT"
exec "$CHROMA_PY/.venv/bin/chroma" run --path "$DATA_PATH" --port "$PORT"
