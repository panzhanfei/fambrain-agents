# 项目简介与技术栈

[← 返回 README](../README.md)

## FamBrain / Agent

基于 **Next.js（App Router）** 的家庭协作型对话应用：注册登录、成员审核、会话与消息持久化，以及 **P0 多 Agent 聊天闭环**（意图路由 → 知识库检索 → 归纳回答，SSE 流式）。

**当前进度（2026-06）：** 在线 LangGraph 多 Agent 闭环 ✅；`@fambrain/corpus` / `@fambrain/agent-memory` 已抽包。**下一步：** [质量冲刺 10 日计划](./03-roadmap.md#质量冲刺--10-日计划2026-06)；消坑见 [坑点 §三](./04-pitfalls.md#三集中消坑计划核心-agent-完成后--并入-10-日质量冲刺)。详见 [路线图](./03-roadmap.md) · [流程图](./02-agent-flows.md) · [实验](../experiments/README.md)。

## 应用层技术栈

| 层级 | 选型 |
|------|------|
| 框架 | Next.js 16、React 19 |
| 数据库 | SQLite + Prisma 7（客户端生成至 `packages/db/src/generated/prisma`） |
| 校验 | Zod |
| 认证 | httpOnly Cookie + JWT（`jose`）、密码哈希（`bcryptjs`） |
| 包管理 | **pnpm**（见 `packageManager`；勿提交 `package-lock.json`） |

开发本仓库前，请先阅读根目录 [`AGENTS.md`](../AGENTS.md)：当前 Next.js 与常见教程版本存在差异，以 `node_modules/next/dist/docs/` 为准。

## Agent 相关技术（摘要）

完整 17 项选型、落地状态与 P1 覆盖计划见 [路线图 · 技术选型总表](./03-roadmap.md#技术选型总表17-项)。

| 技术 | 当前用途 |
|------|----------|
| Ollama | 本地 chat + embed（`ChatOllama`、流式 thinking） |
| LangChain | Intake / FactChecker / Analyst / Organizer 模型调用（`SystemMessage` / `HumanMessage`）；**KM 在线检索不调 LLM** |
| LlamaIndex | 离线 `VectorStoreIndex` 入库；在线检索走 `@fambrain/corpus` `searchCorpusVectors` |
| ChromaDB | 按 `corpusUserId` 分 collection；离线入库 + **在线检索** |
| Zod | 注册/会话 + 入库 metadata；**在线 Agent JSON schema**（Intake / KM / FactChecker / Analyst / Organizer） |
| Pino | 知识入库师结构化日志 |
| p-limit | 入库 embed 并发控制；**DocParser** 批量解析并发（`DOC_PARSE_CONCURRENCY`） |
| Redis + BullMQ | `@fambrain/infra`：检索 cache（D5-2）、pipeline 异步队列（可选 `PIPELINE_QUEUE_ENABLED`） |
| Mem0 | 跨会话语义记忆检索，注入 Intake / Analyst prompt |
| LangMem | 单会话摘要压缩（`data/memory/sessions/`），配合 DB 历史裁剪 Intake 上下文 |
| MCP SDK | 实验：`experiment:mcp-vault` 只读列 vault |
| Recall（BM25 sparse） | `recallSparseRetrieve` / `recallKeywordRetrieve`；`verify:sparse-recall`；对比 `experiment:recall-compare` |
| Vercel AI SDK | 实验：`experiment:vercel-ai`（主链仍自研 SSE） |

编排与流程详见 [Agent 流程图](./02-agent-flows.md)。

## 快速开始

**环境：** Node.js 20+；**包管理仅使用 [pnpm](https://pnpm.io/)**（可 `corepack enable` 后与本仓库 `packageManager` 字段对齐）。

```bash
pnpm install
cp .env.example .env
# 生产环境请务必设置足够长的 JWT_SECRET（见下表）
pnpm run db:migrate
pnpm run db:generate
# 本地对话依赖 Ollama，请先安装并拉取模型，例如：
#   ollama pull qwen2.5:14b
pnpm run dev
```

浏览器访问 `http://localhost:${PORT}`（默认 3000，见 `.env` 的 `PORT`）。聊天需本机 **[Ollama](https://ollama.com/)** 已启动，且 `.env` 中 `OLLAMA_HOST`/`OLLAMA_PORT`（或 `OLLAMA_BASE_URL`）与 `OLLAMA_MODEL` 一致。

**pnpm 10+** 若安装后提示需批准依赖的构建脚本（如 `prisma`、`better-sqlite3`），在本仓库根目录执行一次 `pnpm approve-builds` 并按提示勾选即可；`package.json` 里已配置 `pnpm.onlyBuiltDependencies` 作为允许构建的名单，新开环境仍可能需要你本地确认一次。

**better-sqlite3：** 若运行时报 `Could not locate the bindings file`，在项目根执行 `pnpm run rebuild:native`（等同 `pnpm rebuild better-sqlite3`），必要时先执行 `pnpm approve-builds` 允许该包跑安装脚本。

### 首次使用说明

- **首个注册用户**会成为 `ADMIN`；其余成员默认 `PENDING`，需具备「成员审核」权限的账号在 `/admin/users` 通过后变为 `ACTIVE` 才可进入主界面。
- **聊天区**：侧栏会话与历史来自数据库；发送消息走 `POST /api/conversations/:id/messages`（**SSE 流式**），经 **Orchestrator → Pipeline → 五个 Worker Agent** 生成回复，**仅将最终 assistant 正文落库**（中间路由/检索结果在内存传递，不写 `messages` 表）。
- **登录/注册表单**使用 `apps/web/src/actions/auth.ts`（Server Actions）；业务逻辑在 `packages/auth/`，与 REST API 共用。

## 脚本（pnpm）

| 命令 | 说明 |
|------|------|
| `pnpm run dev` | 本地开发 |
| `pnpm run build` / `pnpm run start` | 构建 standalone / 生产启动（`apps/web`） |
| `pnpm run pack:deploy` | 本地构建并打 tar 部署包 |
| `pnpm run docker:up` | Docker 一键启动 web + ollama + chroma |
| `pnpm run lint` | ESLint |
| `pnpm run db:generate` | 生成 Prisma Client |
| `pnpm run db:migrate` | 开发环境迁移 |
| `pnpm run db:push` | 无迁移文件时推送 schema（慎用） |
| `pnpm run db:studio` | Prisma Studio |
| `pnpm run rebuild:native` | 重新编译 `better-sqlite3`（解决缺少 `.node` 绑定） |
| `pnpm run chroma:server` | 启动 Chroma HTTP 服务（需 [uv](https://docs.astral.sh/uv/)，数据目录 `data/chroma/`） |
| `pnpm run index:corpus` | **知识入库师**：全量扫描 `corpus/*.md` → embed → 写入 Chroma（语料变更后手动重跑） |
| `pnpm run parse:documents` | **文档解析师**：CLI 批量解析本地文件 → corpus md（可选入库） |
| `cd apps/agents && pnpm run verify:memory` | Mem0 / LangMem 本地验证（LangMem 可不依赖 Mem0） |
| `cd apps/agents && pnpm run verify:doc-parser` | DocParser 格式与路径单测 |
| `pnpm run summarize:document -- <file.md>` | 内容摘要师（需 Ollama） |
| `pnpm run experiment:mcp-vault` | MCP stdio 服务（列 vault） |
| `pnpm run experiment:recall-compare -- <userId> "query"` | Recall vs 向量检索 |
| `pnpm run experiment:vercel-ai -- "prompt"` | Vercel AI 流式 demo |
| `cd apps/agents && pnpm run verify:content-summarizer` | 摘要师 Zod 单测 |
| `cd apps/agents && pnpm run verify:vault-list` | vault 列举单测 |

## 环境变量

复制 `.env.example` 为 `.env` 后按需修改。

| 变量 | 必填 | 说明 |
|------|------|------|
| `PORT` | 否 | Web 端口，默认 `3000`（`pnpm run dev` / `start` / Docker 映射） |
| `AGENTS_HOST` / `AGENTS_PORT` | 建议 | Agent HTTP 服务，默认 `127.0.0.1:3001`；Web BFF 通过此地址调用 pipeline |
| `AGENTS_SERVICE_URL` | 否 | 完整 Agent 服务 URL；Docker 内通常为 `http://agents:3001` |
| `OLLAMA_HOST` / `OLLAMA_PORT` | 建议 | Ollama 地址；或用 `OLLAMA_BASE_URL` 直接覆盖 |
| `CHROMA_HOST` / `CHROMA_PORT` | 否 | 本地 Chroma（`pnpm run chroma:server`）；或用 `CHROMA_SERVER_URL` 覆盖 |
| `DATABASE_URL` | 建议 | 默认 `file:./packages/db/prisma/dev.db`（相对仓库根目录 `.env`） |
| `JWT_SECRET` | 生产必填 | 长度 ≥ 24；开发未设置时会使用占位密钥（控制台告警） |
| `JWT_RENEW_BEFORE_EXPIRY_SEC` | 否 | 中间件刷新 Cookie 的提前量（秒），默认约 4 天 |
| `LOGIN_RATE_LIMIT_MAX` / `LOGIN_RATE_LIMIT_WINDOW_MS` | 否 | 登录接口内存限流 |
| `REGISTER_RATE_LIMIT_MAX` / `REGISTER_RATE_LIMIT_WINDOW_MS` | 否 | 注册接口内存限流 |
| `LOGOUT_RATE_LIMIT_MAX` / `LOGOUT_RATE_LIMIT_WINDOW_MS` | 否 | 登出接口内存限流 |
| `TRUST_PROXY_HEADERS` | 否 | 设为 `true` 时信任 `X-Forwarded-*`（反向代理场景） |
| `SECURITY_ENABLE_HSTS` | 否 | 设为 `true` 时在响应头启用 HSTS |
| `FAMBRAIN_MEMBERSHIP_AUDIT_ID_SUFFIX` | 否 | 身份证号后缀匹配则拥有「审核成员」权限；不设则用代码内默认值 |
| `OLLAMA_BASE_URL` | 否 | 完整 Ollama URL；不设则由 `OLLAMA_HOST` + `OLLAMA_PORT` 拼接 |
| `OLLAMA_MODEL` | 建议 | 默认 `qwen2.5:14b`；Intake / Analyst 等未单独配置时使用 |
| `OLLAMA_MODEL_INTAKE_COORDINATOR` | 否 | 仅入口接线员专用模型；不配则等于 `OLLAMA_MODEL` |
| `OLLAMA_MODEL_EMBED` | 否 | 嵌入模型；不配则 `nomic-embed-text`（知识入库师 embed 用） |
| `INDEX_EMBED_CONCURRENCY` | 否 | 入库 embed 同时进行的批次数，默认 `3`（上限 16） |
| `INDEX_EMBED_BATCH_SIZE` | 否 | 每批 chunk 数，默认 `8`（上限 64） |
| `CHROMA_SERVER_URL` | 否 | Chroma HTTP 客户端地址；不设则由 `CHROMA_HOST` + `CHROMA_PORT` 拼接（先 `pnpm run chroma:server`） |
| `OLLAMA_STREAM_THINK` | 否 | 流式是否请求 thinking；不支持时服务端会自动降级重试 |
| `FAMBRAIN_CORPUS_USER_ID` | 否 | 强制所有登录用户检索 `data/doc/users/<此 userId>/`；不设则按用户表 `corpusUserId` 或本人 id |
| `DOC_PARSE_CONCURRENCY` | 否 | DocParser 批量解析并发，默认 `2` |
| `OLLAMA_MODEL_VISION` | 否 | 图片 OCR 视觉模型，默认沿用 `OLLAMA_MODEL`（建议 `llava` 等） |
| `MEM0_ENABLED` / `LANGMEM_ENABLED` | 否 | 记忆层开关，默认 `true` |
| `MEM0_HISTORY_DB_PATH` | 否 | Mem0 SQLite，默认 `data/memory/mem0/history.db` |
| `LANGMEM_SESSIONS_DIR` | 否 | LangMem 会话摘要目录，默认 `data/memory/sessions` |
| `LANGMEM_SUMMARIZE_AFTER_TURNS` | 否 | 满 N 轮后触发会话摘要，默认 `8` |
| `LANGMEM_KEEP_RECENT_TURNS` | 否 | 摘要后保留最近轮数，默认 `4` |

单机内存限流不适用于多副本；上生产请在前端网关或 Redis 等侧做统一限流。

## 代码结构（Monorepo）

| 路径 | 职责 |
|------|------|
| `apps/web/` | Next.js UI + BFF；`.next` 产物在此目录 |
| `apps/agents/` | Agent 业务：orchestrator、pipeline、各 Worker、Indexer CLI |
| `packages/db/` | Prisma schema、migrations、会话 repo |
| `packages/auth/` | JWT、登录注册、会话 |
| `packages/agent-types/` | `DbChatTurn`、`AgentPipelineContext` 等共享类型 |
| `packages/agent-config/` | Ollama / Chroma 环境配置 |
| `packages/agent-shared/` | agent-log、ollama-native-stream |
| `apps/web/src/server/chat/handle-post-message.ts` | 存用户消息 → 调 Orchestrator → SSE → 存 assistant |
| `apps/web/src/app/api/conversations/[id]/messages/route.ts` | GET 历史；POST 鉴权后委托 BFF |
| `data/doc/users/<userId>/corpus/` | 可检索履历 Markdown；`vault/` 为私人原件 |

**约定：** `@fambrain/agents` 不直接访问数据库；编排层不把中间 Agent 输出写入 `messages`。

## P0 已落地能力（代码索引）

| 技能点 | 代码位置 | 用途 |
|--------|----------|------|
| `runAgentStream` + `runPipelineStream` | `apps/agents/src/agentflow/`、`pipeline/graph/stream.ts` | LangGraph 编排 + SSE |
| `getCompiledPipelineGraph` | `pipeline/graph/compile.ts` | Intake → KM → FactChecker → **ContentOrganizer** → Analyst |
| `parseIntakeDecision` / `defaultIntakeDecision` | `pipeline/parse-intake.ts` | 解析 Intake 路由 JSON |
| `completeIntakeCoordinator` | `agentflow/agents/online/intake-coordinator/` | 一次 `invoke` → 路由 JSON |
| `retrieveKnowledge` | `agentflow/agents/online/knowledge-manager/` | 向量 + 关键词扫盘 + **规则精排**（无 LLM）；v3 业界对标见 [km-retrieval-design.md](./km-retrieval-design.md) |
| `completeFactCheck` | `agentflow/agents/online/fact-checker/` | 证据包核查；打回再检索 |
| `organizeKnowledge` | `agentflow/agents/online/content-organizer/` | hits Zod 规范化 + path 去重 |
| `streamAnalyzeInformation` | `agentflow/agents/online/information-analyst/` | 流式 thinking + assistant |
| `golden:regression` | `apps/agents/scripts/golden-regression.ts` | 在线 Agent **G1～G5 全链路标准回归**（最终验收） |
| `verify:fact-checker` / `verify:fact-checker:pipeline` | `apps/agents/scripts/` | FactChecker 规则 + 轻量全链路冒烟 |
| `verify:content-organizer` / `verify:agent-schemas` | `apps/agents/scripts/` | ContentOrganizer / 全 Agent Zod |
| `verify:embed-batches` | `apps/agents/scripts/` | Indexer p-limit 分批逻辑 |
| `verify:memory` / `verify:doc-parser` | `apps/agents/scripts/` | Mem0+LangMem / DocParser |
| `preparePipelineMemory` | `agentflow/memory/` | 每轮加载 Mem0 + LangMem → `memoryBlock` |
| `ingestDocumentBatch` | `agentflow/agents/offline/doc-parser/` | 批量上传解析 → corpus + 可选入库 |
| `summarizeContent` | `agentflow/agents/online/content-summarizer/` | 在线摘要分支 + CLI（D9） |
| `listVaultFiles` | `agentflow/knowledge/list-vault-files.ts` | vault 只读列举（MCP 共用） |
| `recallSparseRetrieve` | `packages/corpus/src/recall-keyword-retrieve.ts` | BM25 sparse 检索（HY-01） |
| `hybridRecall` / `fuseRrf` | `knowledge-manager/hybrid-recall.ts`、`fusion-rrf.ts` | 并行 Hybrid + RRF（HY-02～03） |
| `@fambrain/infra` | `packages/infra/` | Redis 连接、检索 cache、BullMQ 队列、限流 |
| `verify:retrieval-cache` | `apps/agents/scripts/` | D5-2 cache normalize + memory/Redis |
| `verify:recall-compare` | `apps/agents/scripts/` | HY-07 三问 vector/sparse/RRF（需 Chroma） |
| `verify:confidence-tier` | `apps/agents/scripts/` | Wave D：assessConfidence 单测 + KM live tier |
| `verify:intake-coreference` | `apps/agents/scripts/` | Wave C QU-02：Intake 多轮指代 live 抽检 |
| `eval:run` | `apps/agents/scripts/eval/` | Eval MVP：golden.json + 四指标报告（含 G5b 指代） |
| `golden:regression` | `apps/agents/scripts/` | G1～G5 全链路回归（多遍稳定性） |
| `indexAllCorpora` | `agentflow/agents/offline/knowledge-indexer/` | 离线 corpus → Chroma |
| `logAgentIn` / `logAgentOut` | `packages/agent-shared/src/agent-log.ts` | 调试：含 FactChecker 🔍、ContentOrganizer 📋 |
