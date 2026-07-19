#!/usr/bin/env bash
# 一次性安装 Chroma Python 依赖（类似 pnpm install → node_modules）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CHROMA_PY="$ROOT/tools/chroma-server"

export PATH="${HOME}/.local/bin:${PATH}"
if ! command -v uv >/dev/null 2>&1; then
  echo "未找到 uv，请先安装：https://docs.astral.sh/uv/" >&2
  exit 1
fi

echo "Chroma: uv sync → tools/chroma-server/.venv"
(cd "$CHROMA_PY" && uv sync)
echo "Chroma: 依赖已就绪，可运行 pnpm run chroma:server"
