<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

## Monorepo 布局

- **Web + BFF**：`apps/web/`（Next.js，`output: standalone`）
- **Brain 服务**：`apps/brain/`（uv workspace，FastAPI）。监听 `BRAIN_SERVICE_PORT`（默认仍可由 `BRAIN_PY_PORT` 覆盖）。Web 通过 `BRAIN_SERVICE_URL` 调用。账号认 Prisma SQLite 里的 cuid 和同一把 `JWT_SECRET`。Postgres 只用 `FAMBRAIN_DATABASE_URL`。评测：`pnpm eval:brain`。说明见 `docs/07-python-backend.md`
- **DB / Auth / Brain 公共包**：`packages/*`
- **环境变量**：仓库根目录 `.env` 唯一来源；端口用 `PORT` / `OLLAMA_HOST`+`OLLAMA_PORT` / `QDRANT_HOST`+`QDRANT_PORT`（完整 URL 变量可覆盖）
- **Chat**：`CHAT_PROVIDER=ollama|openai` **须显式切换**；openai 默认 DeepSeek。失败不静默回落 14b。embed / OCR / Mem0 仍走 Ollama。**不接入 Dify**
- **语料 / 向量库**：`data/doc/`；Qdrant（语料 dense+sparse，Mem0 dense-only）
- **本地 Qdrant**：`pnpm run qdrant:server` 或 `pnpm dev` 自动 `docker compose up -d qdrant`

## 模块目录约定（详见 `.cursor/rules/module-folder-conventions.mdc`）

- 每个职责文件夹：`index.ts`（聚合导出）+ `interface.ts`（类型）
- 图节点：单节点写包根 `index.ts`；多节点写 `子目录/index.ts`；**不建** `node/`
- 同级 import 用 `./`；跨目录用 `@.../<folder>`，禁止深挖实现文件

## Agent 硬编码（必读）

生产路径**不许硬编码**问句口语、Mem0 字段名表、场景/人名分支来猜意图或补 plan；只信 Intake 结构化字段 + schema→executor。详见 `.cursor/rules/no-scene-hardcoding.mdc`（`alwaysApply: true`）。
<!-- END:nextjs-agent-rules -->
