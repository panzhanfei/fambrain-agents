# syntax=docker/dockerfile:1

FROM node:20-bookworm-slim AS base
RUN corepack enable && corepack prepare pnpm@10.11.0 --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/web/package.json apps/web/
COPY apps/brain-service/package.json apps/brain-service/
COPY packages/brain-types/package.json packages/brain-types/
COPY packages/brain-config/package.json packages/brain-config/
COPY packages/brain-shared/package.json packages/brain-shared/
COPY packages/db/package.json packages/db/
COPY packages/auth/package.json packages/auth/
RUN pnpm install --frozen-lockfile

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm --filter @fambrain/db generate
RUN pnpm --filter @fambrain/web build

FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public
COPY --from=builder /app/packages/db/prisma ./packages/db/prisma
COPY --from=builder /app/data ./data

EXPOSE 3000
CMD ["node", "apps/web/server.js"]
