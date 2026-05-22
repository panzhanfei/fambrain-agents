#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WEB="$ROOT/apps/web"
OUT="$ROOT/dist/deploy"
STAMP="$(date +%Y%m%d-%H%M%S)"
ARCHIVE="$ROOT/dist/fambrain-deploy-${STAMP}.tar.gz"

echo "==> Building monorepo (db generate + next standalone)..."
cd "$ROOT"
pnpm run build

echo "==> Packing standalone deploy bundle..."
rm -rf "$OUT"
mkdir -p "$OUT/standalone" "$OUT/static" "$OUT/public"

cp -R "$WEB/.next/standalone/." "$OUT/standalone/"
mkdir -p "$OUT/standalone/apps/web/.next"
cp -R "$WEB/.next/static/." "$OUT/standalone/apps/web/.next/static/"
cp -R "$WEB/public/." "$OUT/standalone/apps/web/public/"

mkdir -p "$OUT/data" "$OUT/packages/db/prisma"
cp -R "$ROOT/data/chroma" "$OUT/data/" 2>/dev/null || mkdir -p "$OUT/data/chroma"
cp -R "$ROOT/data/doc" "$OUT/data/" 2>/dev/null || mkdir -p "$OUT/data/doc"
cp "$ROOT/packages/db/prisma/dev.db" "$OUT/packages/db/prisma/" 2>/dev/null || true

cat > "$OUT/start.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/standalone"
export NODE_ENV=production
# 在部署目录旁放置 .env，至少设置 DATABASE_URL（建议绝对路径）
exec node apps/web/server.js
EOF
chmod +x "$OUT/start.sh"

mkdir -p "$ROOT/dist"
tar -czf "$ARCHIVE" -C "$OUT" .

echo "==> Done."
echo "    Bundle dir: $OUT"
echo "    Archive:    $ARCHIVE"
echo "    Upload archive to server, extract, copy .env, run ./start.sh"
