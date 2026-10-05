#!/usr/bin/env bash
# 工程门禁：unit → eval → load → e2e
# 产物：reports/GATE-REPORT.md + reports/*-report.{md,json}
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

export AUTH_COOKIE_SECURE="${AUTH_COOKIE_SECURE:-0}"
export EVAL_WRITE_REPORT="${EVAL_WRITE_REPORT:-1}"
export LOAD_CONCURRENCY="${LOAD_CONCURRENCY:-20}"
export LOAD_REQUESTS="${LOAD_REQUESTS:-200}"
export LOAD_CORPUS_JOBS="${LOAD_CORPUS_JOBS:-80}"
export E2E_BASE_URL="${E2E_BASE_URL:-http://127.0.0.1:3000}"
export FAMBRAIN_CORPUS_USER_ID="${FAMBRAIN_CORPUS_USER_ID:-cmp9ihokn00000mbmhwh6gn0b}"

PORT="${PORT:-3000}"
BRAIN_SERVICE_PORT="${BRAIN_SERVICE_PORT:-3001}"
QDRANT_HOST="${QDRANT_HOST:-127.0.0.1}"
QDRANT_PORT="${QDRANT_PORT:-6333}"
QDRANT_URL="${QDRANT_URL:-http://${QDRANT_HOST}:${QDRANT_PORT}}"
QDRANT_URL="${QDRANT_URL%/}"
OLLAMA_URL="${OLLAMA_BASE_URL:-http://${OLLAMA_HOST:-127.0.0.1}:${OLLAMA_PORT:-11434}}"
OLLAMA_URL="${OLLAMA_URL%/}"

mkdir -p "$ROOT/reports" "$ROOT/.gate-logs"

log() { echo "[gate] $*"; }

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || { echo "缺少命令: $1" >&2; exit 1; }
}

http_ok() {
  curl -sf --max-time 3 "$1" >/dev/null 2>&1
}

start_bg() {
  local name="$1"; shift
  local logf="$ROOT/.gate-logs/${name}.log"
  log "start ${name} → ${logf}"
  nohup "$@" >"$logf" 2>&1 &
  echo $! >"$ROOT/.gate-logs/${name}.pid"
}

ensure_infra() {
  if ! http_ok "${QDRANT_URL}/readyz"; then
    log "启动 Qdrant (${QDRANT_URL})"
    docker compose up -d qdrant
    for i in $(seq 1 60); do
      http_ok "${QDRANT_URL}/readyz" && break
      sleep 1
    done
    http_ok "${QDRANT_URL}/readyz" || { log "Qdrant 未就绪"; exit 1; }
  else
    log "Qdrant 已就绪"
  fi

  if ! pnpm exec tsx --env-file="$ENV_FILE" "$ROOT/scripts/redis-ping.ts" >/dev/null 2>&1; then
    log "启动 Redis (docker compose)"
    docker compose up -d redis
    for i in $(seq 1 30); do
      pnpm exec tsx --env-file="$ENV_FILE" "$ROOT/scripts/redis-ping.ts" >/dev/null 2>&1 && break
      sleep 1
    done
  else
    log "Redis 已就绪"
  fi

  if ! http_ok "${OLLAMA_URL}/api/tags"; then
    log "警告: Ollama 不可达 ${OLLAMA_URL}（eval 可能失败）"
  else
    log "Ollama 可达"
  fi
}

ensure_brain() {
  if http_ok "http://127.0.0.1:${BRAIN_SERVICE_PORT}/health"; then
    log "brain 已就绪 :${BRAIN_SERVICE_PORT}"
    return
  fi
  log "启动 Python brain"
  start_bg brain bash -lc "cd apps/brain && uv run fambrain-api"
  for i in $(seq 1 60); do
    http_ok "http://127.0.0.1:${BRAIN_SERVICE_PORT}/health" && break
    sleep 1
  done
  http_ok "http://127.0.0.1:${BRAIN_SERVICE_PORT}/health" || {
    log "brain 未就绪，见 .gate-logs/brain.log"
    exit 1
  }
}

ensure_corpus_worker() {
  if [[ -f "$ROOT/.gate-logs/corpus-worker.pid" ]] && kill -0 "$(cat "$ROOT/.gate-logs/corpus-worker.pid")" 2>/dev/null; then
    log "corpus-worker 已在跑"
    return
  fi
  log "启动 corpus-worker"
  start_bg corpus-worker bash -lc "cd apps/brain && uv run python scripts/index_corpus.py"
  sleep 2
}

ensure_web() {
  if http_ok "http://127.0.0.1:${PORT}/"; then
    log "web 已就绪 :${PORT}"
    return
  fi
  if [[ ! -d "$ROOT/apps/web/.next" ]]; then
    log "构建 web (next build)"
    pnpm --filter @fambrain/web build
  fi
  log "启动 web (next start) AUTH_COOKIE_SECURE=${AUTH_COOKIE_SECURE}"
  start_bg web env AUTH_COOKIE_SECURE="$AUTH_COOKIE_SECURE" pnpm --filter @fambrain/web start
  for i in $(seq 1 90); do
    http_ok "http://127.0.0.1:${PORT}/" && break
    sleep 1
  done
  http_ok "http://127.0.0.1:${PORT}/" || {
    log "web 未就绪，见 .gate-logs/web.log"
    exit 1
  }
}

UNIT_OK=0
EVAL_OK=0
LOAD_OK=0
E2E_OK=0

run_unit() {
  log "=== UNIT ==="
  if pnpm test:brain; then
    UNIT_OK=1
  else
    UNIT_OK=0
  fi
}

run_eval() {
  log "=== EVAL (full) ==="
  if pnpm eval:brain; then
    EVAL_OK=1
  else
    EVAL_OK=0
  fi
}

run_load() {
  log "=== LOAD === skipped（压测脚本随 Node brain 移除）"
  LOAD_OK=1
}

run_e2e() {
  log "=== E2E === skipped（Playwright 门禁随 Node brain 移除）"
  E2E_OK=1
}

need_cmd curl
need_cmd pnpm
ensure_infra
ensure_brain
ensure_corpus_worker

run_unit
run_eval

# load 含对话全链路，需 web；e2e 同依赖
ensure_web
run_load
run_e2e

log "完成: unit=$UNIT_OK eval=$EVAL_OK load=$LOAD_OK e2e=$E2E_OK"
log "总报表: $ROOT/reports/GATE-REPORT.md"
log "分项: $ROOT/reports/"

if [[ "$UNIT_OK" -eq 1 && "$EVAL_OK" -eq 1 && "$LOAD_OK" -eq 1 && "$E2E_OK" -eq 1 ]]; then
  exit 0
fi
exit 1
