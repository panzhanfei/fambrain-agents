# 项目简介与技术栈

[← 返回 README](../README.md)

## FamBrain / Agent

基于 **Next.js（App Router）** 的家庭协作型对话应用：注册登录、成员审核、会话与消息持久化，以及 **P0 多 Agent 聊天闭环**（意图路由 → 知识库检索 → 归纳回答，SSE 流式）。

**当前进度（2026-05）：** 离线知识入库师 **已实现**；在线向量检索、LangGraph、事实核查等待 D3+。详见 [路线图](./03-roadmap.md)。

## 应用层技术栈

| 层级 | 选型 |
|------|------|
| 框架 | Next.js 16、React 19 |
| 数据库 | SQLite + Prisma 7（客户端生成至 `src/generated/prisma`） |
| 校验 | Zod |
| 认证 | httpOnly Cookie + JWT（`jose`）、密码哈希（`bcryptjs`） |
| 包管理 | **pnpm**（见 `packageManager`；勿提交 `package-lock.json`） |

开发本仓库前，请先阅读根目录 [`AGENTS.md`](../AGENTS.md)：当前 Next.js 与常见教程版本存在差异，以 `node_modules/next/dist/docs/` 为准。

## Agent 相关技术（摘要）

完整 17 项选型、落地状态与 P1 覆盖计划见 [路线图 · 技术选型总表](./03-roadmap.md#技术选型总表17-项)。

| 技术 | 当前用途 |
|------|----------|
| Ollama | 本地 chat + embed（`ChatOllama`、流式 thinking） |
| LangChain | Intake / KM 模型调用（`SystemMessage` / `HumanMessage`） |
| LlamaIndex | 离线 `VectorStoreIndex` 入库；在线 retriever 待 D3 |
| ChromaDB | 按 `corpusUserId` 分 collection，持久化于 `data/chroma/` |
| Zod | 注册/会话 + 入库 `chunkMetadataSchema` |
| Pino | 知识入库师结构化日志 |

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

浏览器访问 [http://localhost:3000](http://localhost:3000)。聊天需本机 **[Ollama](https://ollama.com/)** 已启动，且 `.env` 中 `OLLAMA_BASE_URL` / `OLLAMA_MODEL` 与本地已拉取模型一致。

**pnpm 10+** 若安装后提示需批准依赖的构建脚本（如 `prisma`、`better-sqlite3`），在本仓库根目录执行一次 `pnpm approve-builds` 并按提示勾选即可；`package.json` 里已配置 `pnpm.onlyBuiltDependencies` 作为允许构建的名单，新开环境仍可能需要你本地确认一次。

**better-sqlite3：** 若运行时报 `Could not locate the bindings file`，在项目根执行 `pnpm run rebuild:native`（等同 `pnpm rebuild better-sqlite3`），必要时先执行 `pnpm approve-builds` 允许该包跑安装脚本。

### 首次使用说明

- **首个注册用户**会成为 `ADMIN`；其余成员默认 `PENDING`，需具备「成员审核」权限的账号在 `/admin/users` 通过后变为 `ACTIVE` 才可进入主界面。
- **聊天区**：侧栏会话与历史来自数据库；发送消息走 `POST /api/conversations/:id/messages`（**SSE 流式**），经 **Orchestrator → Pipeline → 三个 Worker Agent** 生成回复，**仅将最终 assistant 正文落库**（中间路由/检索结果在内存传递，不写 `messages` 表）。
- **登录/注册表单**使用 `src/actions/auth.ts`（Server Actions）；业务逻辑在 `src/server/auth/`，与 REST API 共用。

## 脚本（pnpm）

| 命令 | 说明 |
|------|------|
| `pnpm run dev` | 本地开发 |
| `pnpm run build` / `pnpm run start` | 构建与生产启动 |
| `pnpm run lint` | ESLint |
| `pnpm run db:generate` | 生成 Prisma Client |
| `pnpm run db:migrate` | 开发环境迁移 |
| `pnpm run db:push` | 无迁移文件时推送 schema（慎用） |
| `pnpm run db:studio` | Prisma Studio |
| `pnpm run rebuild:native` | 重新编译 `better-sqlite3`（解决缺少 `.node` 绑定） |
| `pnpm run chroma:server` | 启动 Chroma HTTP 服务（需 [uv](https://docs.astral.sh/uv/)，数据目录 `data/chroma/`） |
| `pnpm run index:corpus` | **知识入库师**：全量扫描 `corpus/*.md` → embed → 写入 Chroma（语料变更后手动重跑） |

## 环境变量

复制 `.env.example` 为 `.env` 后按需修改。

| 变量 | 必填 | 说明 |
|------|------|------|
| `DATABASE_URL` | 建议 | 默认 `file:./prisma/dev.db`（相对仓库根目录） |
| `JWT_SECRET` | 生产必填 | 长度 ≥ 24；开发未设置时会使用占位密钥（控制台告警） |
| `JWT_RENEW_BEFORE_EXPIRY_SEC` | 否 | 中间件刷新 Cookie 的提前量（秒），默认约 4 天 |
| `LOGIN_RATE_LIMIT_MAX` / `LOGIN_RATE_LIMIT_WINDOW_MS` | 否 | 登录接口内存限流 |
| `REGISTER_RATE_LIMIT_MAX` / `REGISTER_RATE_LIMIT_WINDOW_MS` | 否 | 注册接口内存限流 |
| `LOGOUT_RATE_LIMIT_MAX` / `LOGOUT_RATE_LIMIT_WINDOW_MS` | 否 | 登出接口内存限流 |
| `TRUST_PROXY_HEADERS` | 否 | 设为 `true` 时信任 `X-Forwarded-*`（反向代理场景） |
| `SECURITY_ENABLE_HSTS` | 否 | 设为 `true` 时在响应头启用 HSTS |
| `FAMBRAIN_MEMBERSHIP_AUDIT_ID_SUFFIX` | 否 | 身份证号后缀匹配则拥有「审核成员」权限；不设则用代码内默认值 |
| `OLLAMA_BASE_URL` | 建议 | 默认 `http://127.0.0.1:11434`；对话与 Agent 均通过此地址访问 Ollama |
| `OLLAMA_MODEL` | 建议 | 默认 `qwen2.5:14b`；Intake / Analyst 等未单独配置时使用 |
| `OLLAMA_MODEL_INTAKE_COORDINATOR` | 否 | 仅入口接线员专用模型；不配则等于 `OLLAMA_MODEL` |
| `OLLAMA_MODEL_EMBED` | 否 | 嵌入模型；不配则 `nomic-embed-text`（知识入库师 embed 用） |
| `CHROMA_SERVER_URL` | 否 | Chroma HTTP 地址；默认 `http://127.0.0.1:8000`（先 `pnpm run chroma:server`） |
| `OLLAMA_STREAM_THINK` | 否 | 流式是否请求 thinking；不支持时服务端会自动降级重试 |
| `FAMBRAIN_CORPUS_USER_ID` | 否 | 强制所有登录用户检索 `src/doc/users/<此 userId>/`；不设则按用户表 `corpusUserId` 或本人 id |

单机内存限流不适用于多副本；上生产请在前端网关或 Redis 等侧做统一限流。

## 代码结构（P0）

| 路径 | 职责 |
|------|------|
| `src/agents/orchestrator/` | **对话唯一入口** `runAgentStream(history)` |
| `src/agents/pipeline/` | 编排：`parseIntakeDecision`、`runPipelineStream`（`step` 进度事件） |
| `src/agents/IntakeCoordinator/` | 入口接线员（路由 JSON） |
| `src/agents/KnowledgeIndexer/` | **知识入库师**（离线 CLI：corpus → chunk → embed → Chroma） |
| `src/agents/KnowledgeManager/` | 知识管理员（P0 关键词扫描；D3 计划向量检索 + fallback） |
| `src/agents/InformationAnalyst/` | 信息分析师（流式 `thinking` + `assistant`，终稿 JSON 解析） |
| `src/agents/config/` | Ollama 等运行时配置（读环境变量） |
| `src/server/db/conversation-messages.ts` | 会话消息的 **唯一** Prisma 访问层 |
| `src/server/chat/handle-post-message.ts` | 存用户消息 → 调 Orchestrator → SSE → 存 assistant |
| `src/app/api/conversations/[id]/messages/route.ts` | GET 历史；POST 鉴权后委托 `handle-post-message` |
| `src/lib/chat/sse.ts` | SSE 帧编码 |
| `src/actions/auth.ts` | 登录/注册 Server Actions |
| `src/doc/users/<userId>/corpus/` | 可检索履历 Markdown；`vault/` 为私人原件；见 `src/doc/users/README.md` |

**约定：** `src/agents/*` 不直接访问数据库；编排层不把中间 Agent 输出写入 `messages`。

## P0 已落地能力（代码索引）

| 技能点 | 代码位置 | 用途 |
|--------|----------|------|
| `runAgentStream` + `runPipelineStream` | `orchestrator/`、`pipeline/run-stream.ts` | 服务端编排：进哪个 Agent 由代码查表 |
| `parseIntakeDecision` / `defaultIntakeDecision` | `pipeline/parse-intake.ts` | 解析 Intake 路由 JSON；失败保守查库 |
| `completeIntakeCoordinator` | `IntakeCoordinator/ollama-chat.ts` | 一次 `invoke` → 路由 JSON |
| `scanDocCandidates` + `retrieveKnowledge` | `KnowledgeManager/retrieve.ts` | P0 关键词 RAG + LLM 精排 |
| `coalesceRetrieval` | 同上 | 空 hits 时回退关键词命中 |
| `streamAnalyzeInformation` | `InformationAnalyst/stream.ts` | 流式 thinking + assistant |
| `indexAllCorpora` / `indexOneCorpusUser` | `KnowledgeIndexer/` | 离线 corpus → Chroma |
| `logAgentIn` / `logAgentOut` | `agents/shared/agent-log.ts` | 调试：路由 → 检索 → 终稿 |
