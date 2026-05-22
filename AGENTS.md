<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

## Monorepo 布局

- **Web + BFF**：`apps/web/`（Next.js，`output: standalone`）
- **Agent 服务**：`apps/agents/`（HTTP，`AGENTS_PORT`，Web 通过 `AGENTS_SERVICE_URL` 调用）
- **DB / Auth / Agent 公共**：`packages/*`
- **环境变量**：仓库根目录 `.env` 唯一来源；端口用 `PORT` / `OLLAMA_HOST`+`OLLAMA_PORT` / `CHROMA_HOST`+`CHROMA_PORT`（完整 URL 变量可覆盖）
- **语料 / 向量库**：`data/doc/`、`data/chroma/`
<!-- END:nextjs-agent-rules -->
