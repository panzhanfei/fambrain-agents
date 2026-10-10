# 项目简介与技术栈

[← 返回 README](../README.md)

## FamBrain

基于 **Next.js（App Router）** 的家庭协作型对话应用：注册登录、成员审核、会话与消息持久化，以及 **多 Agent 聊天闭环**（Intake 结构化工单 → PathPlan 并行取数 → 归纳回答，SSE 流式）。

流程与编排见 [02-agent-flows.md](./02-agent-flows.md)。

Python 后端在 `apps/brain`（FastAPI + PostgreSQL，默认端口 3011）。对话主链、检索、列举和用户事实已经能按同一份 golden.json 评测；现网 Web 仍打到 Node。见 [07-python-backend.md](./07-python-backend.md)。

## 现状（2026-08）

| 项 | 口径 |
|----|------|
| **编排** | 主图 `fambrain-pipeline`：TurnStart → Intake → PathPlan fan-out / userFact / 早退 → Organizer → Analyst → `fileHandoff?` → TurnEnd。文件 HITL 在平级图 `agents/sideline/file`（`fambrain-file`），Resume 必须带 `jobId` |
| **意图** | 只信 Intake JSON（`queryType` / `toolId` / `pathPlan.steps` / `userFactKey` 等）+ schema→executor。生产路径不扫问句口语猜意图（P0-34 猜意图抬升 **已删**） |
| **Chat** | `packages/brain-shared/src/chat`：`completeChat` / `streamChat`。`CHAT_PROVIDER=ollama\|openai` **须显式切换**；openai 默认 `https://api.deepseek.com` + `deepseek-v4-flash`。失败 **不会** 静默回落本地 14b |
| **不接入 Dify** | 提示词、Zod schema、LangGraph 编排都在本仓库；没有「抽到 Dify 再复盘」的阶段 |
| **工具** | `tools/catalog` 登记 `toolId`，生产执行 `invokeTool`。模型 **不** `tools/list` / ReAct / `bindTools`。天气 `get_weather` → MCP Open-Meteo |
| **检索** | Qdrant 语料 dense+sparse 引擎加权 RRF；KM 无 Chat LLM 精排。`default` + 槽 `topics` 含 `experience`/`project`/`family` → 对应 `docKind` 过滤 |
| **记忆** | Mem0 跨会话结构化事实（Qdrant dense）；LangMem 会话摘要（跟 `CHAT_PROVIDER`）。embed / OCR / Mem0 SDK llm+embed 仍走 **Ollama** |
| **补救** | FactChecker 模块已删；Join 后全局再规划 B ≤1 |
| **回归** | Golden G1～G5c + GMem（`GOLDEN_RUNS=3`）；eval 主表曾 **30/30**。`G-履历综合-t4` 偶发 DeepSeek 空助手文本属 API 抖动，不是规划 bug |

**铁律：** 不许硬编码口语/字段名表猜意图。见 `.cursor/rules/no-scene-hardcoding.mdc`。

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

| 技术 | 当前用途 |
|------|----------|
| `completeChat` / `streamChat` | `@fambrain/brain-shared/chat`：在线 Chat 统一入口（Intake / Analyst / 摘要 / 全局 B / LangMem / 抽记忆 / DAG 填表）。跟 `CHAT_PROVIDER` |
| Ollama | embed / 图片 OCR / Mem0 SDK 的 llm+embed；`CHAT_PROVIDER=ollama` 时也承担在线 chat |
| OpenAI 兼容 HTTP | `CHAT_PROVIDER=openai`：默认 DeepSeek `chat/completions`；JSON 模式 `response_format: json_object` |
| LangChain | embed 经 `@langchain/ollama`（`@fambrain/corpus`）；**StructuredTool** 仅实验 `bindTools` / `verify:langchain-tools`。主链 **不** ReAct |
| LangSmith | 配 `LANGSMITH_API_KEY` 后自动上报 [smith.langchain.com](https://smith.langchain.com)；`/health` 可见状态 |
| Qdrant | 语料按 `corpusUserId` 分 collection（named vectors `dense`+`sparse`，引擎 RRF）；Mem0 独立 unnamed dense collection；单文件 HITL 按 path 增量 upsert |
| Zod | 注册/会话 + 入库 metadata；**在线 Agent JSON schema**（Intake / KM / Analyst / Organizer） |
| Pino | 知识入库师结构化日志 |
| p-limit | 入库 embed 并发控制；**DocParser** 批量解析并发（`DOC_PARSE_CONCURRENCY`） |
| Redis + BullMQ | `@fambrain/infra`：检索 hits 缓存（D5-2）、pipeline 异步队列（可选 `PIPELINE_QUEUE_ENABLED`） |
| Mem0 | 跨会话语义记忆；向量落 **Qdrant** 独立 collection（`fambrain_user_memories`，dense-only），history 在 SQLite；**P0-16** 结构化 remember/recall 经 **userFact** |
| LangMem | 单会话摘要压缩，落 **Prisma `Conversation.sessionSummary`**，配合 Message 历史裁剪 Intake 上下文 |
| MCP | **生产：** `tools/mcp/server/weather`（Open-Meteo，`get_weather`）。实验：`experiment:mcp-vault` 只读列 vault |
| Recall（Qdrant sparse） | 入库时写 BM25-style TF + `idf` modifier；在线 `searchCorpusSparse` / `recallKeywordRetrieve`（**不再**查询时扫盘建内存 BM25）；对比 `experiment:recall-compare` |
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
# Chat 走 openai（DeepSeek）时：CHAT_PROVIDER=openai + OPENAI_API_KEY（或 DEEPSEEK_API_KEY）
# embed / OCR 仍需 Ollama，例如：ollama pull bge-m3
# 仅本地 Chat：CHAT_PROVIDER=ollama 且 ollama pull qwen2.5:14b
# 本地 Qdrant：pnpm run qdrant:server，或让 pnpm dev 自动 docker compose up qdrant
# pnpm dev 会自动启动/等待 Qdrant、Redis（可 Docker 拉起），并起 Web + Brain Service
pnpm run dev
```

浏览器访问 `http://localhost:${PORT}`（默认 3000，见 `.env` 的 `PORT`）。**Qdrant / Redis 无需另开终端**（`scripts/dev-all.sh` 会检测就绪或自动启动；Redis 不可达且 `DEV_REDIS_AUTO_START=1` 时用 `docker compose up redis`）。`CHAT_PROVIDER=openai` 时对话走 DeepSeek 等兼容接口；embed / OCR / Mem0 向量仍需 **[Ollama](https://ollama.com/)**（`OLLAMA_HOST`/`OLLAMA_PORT` 或 `OLLAMA_BASE_URL`）。`CHAT_PROVIDER=ollama` 时 `OLLAMA_MODEL` 须与本地已 pull 模型一致。

**向量库：** 语料（dense + sparse）与 Mem0（dense-only）都走本机 Qdrant（`QDRANT_HOST`/`QDRANT_PORT` 或 `QDRANT_URL`）。Collection 隔离：语料 `fambrain_corpus_<userId>`，Mem0 `fambrain_user_memories`。

**pnpm 10+** 若安装后提示需批准依赖的构建脚本（如 `prisma`、`better-sqlite3`），在本仓库根目录执行一次 `pnpm approve-builds` 并按提示勾选即可；`package.json` 里已配置 `pnpm.onlyBuiltDependencies` 作为允许构建的名单，新开环境仍可能需要你本地确认一次。

**better-sqlite3：** 若运行时报 `Could not locate the bindings file`，在项目根执行 `pnpm run rebuild:native`（等同 `pnpm rebuild better-sqlite3`），必要时先执行 `pnpm approve-builds` 允许该包跑安装脚本。

### 首次使用说明

- **首个注册用户**会成为 `ADMIN`；其余成员默认 `PENDING`，需具备「成员审核」权限的账号在 `/admin/users` 通过后变为 `ACTIVE` 才可进入主界面。
- **聊天区**：侧栏会话与历史来自数据库；发送消息走 `POST /api/conversations/:id/messages`（**SSE 流式**），经 **Brain 双图**（主图 TurnStart → Intake → PathPlan fan-out / userFact → Analyst → `fileHandoff?` → TurnEnd；可选文件子线 HITL）生成回复，**仅将最终 assistant 正文落库**（中间路由/检索结果在内存传递，不写 `messages` 表）。
- **登录/注册表单**使用 `apps/web/src/actions/auth.ts`（Server Actions）；业务逻辑在 `packages/auth/`，与 REST API 共用。

## 脚本（pnpm）

| 命令 | 说明 |
|------|------|
| `pnpm run dev` | **一键本地开发**：Qdrant + Redis（可选 Docker 自动起）+ Web + Python Brain |
| `pnpm run dev:web` | 仅 Web BFF |
| `pnpm run dev:brain` | 仅 Python Brain HTTP（端口 `BRAIN_SERVICE_PORT`，现有 `.env` 为 `:3001`） |
| `pnpm test:brain` | Python pytest |
| `pnpm eval:brain` | 跑 `apps/brain/eval/golden.json` |
| `pnpm run dev:brain-worker` | Taskiq worker |
| `pnpm run build` / `pnpm run start` | 构建 standalone / 生产启动（`apps/web`） |
| `pnpm run pack:deploy` | 本地构建并打 tar 部署包 |
| `pnpm run docker:up` | Docker 一键启动 web + Python Brain + qdrant + redis |
| `pnpm run lint` | ESLint |
| `pnpm run db:generate` | 生成 Prisma Client |
| `pnpm run db:migrate` | 开发环境迁移 |
| `pnpm run db:push` | 无迁移文件时推送 schema（慎用） |
| `pnpm run db:studio` | Prisma Studio |
| `pnpm run rebuild:native` | 重新编译 `better-sqlite3`（解决缺少 `.node` 绑定） |
| `pnpm run qdrant:server` | 单独 `docker compose up -d qdrant` |
| `pnpm run redis:server` | 单独 `docker compose up -d redis` |
| `pnpm run index:corpus` | **知识入库师**：全量扫描 `corpus/*.md` → embed → 写入 Qdrant（语料变更后手动重跑） |
| `pnpm gate:engineering` | 分层门禁：Python 单测 → golden；报表落 `reports/` |
| `cd apps/web && pnpm run test:e2e` | Playwright（需先 `test:e2e:install` 与本地服务） |
| `pnpm test:all` | **全仓库**：依赖树校验 + Vitest 单元测试 |
| `pnpm test:unit` | Vitest 单元测试（`packages/*` 纯逻辑） |
| `pnpm check:deps` / `pnpm fambrain-check-deps` | 校验 workspace `exports` / `scripts` 入口文件是否存在 |
| `pnpm check:deps -- --scan-imports` | 额外扫描脚本入口内的相对 import 断链 |

## 环境变量

复制 `.env.example` 为 `.env` 后按需修改。

| 变量 | 必填 | 说明 |
|------|------|------|
| `PORT` | 否 | Web 端口，默认 `3000`（`pnpm run dev` / `start` / Docker 映射） |
| `BRAIN_SERVICE_HOST` / `BRAIN_SERVICE_PORT` | 建议 | Brain HTTP 服务，默认 `127.0.0.1:3001`；Web BFF 通过此地址调用 pipeline |
| `BRAIN_SERVICE_URL` | 否 | 完整 Brain 服务 URL；Docker 内通常为 `http://brain-service:3001` |
| `OLLAMA_HOST` / `OLLAMA_PORT` | 建议 | Ollama 地址；或用 `OLLAMA_BASE_URL` 直接覆盖 |
| `QDRANT_HOST` / `QDRANT_PORT` | 否 | 本地 Qdrant；`pnpm dev` 会自动启动/等待；或用 `QDRANT_URL` 覆盖 |
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
| `OLLAMA_MODEL` | `CHAT_PROVIDER=ollama` 时建议 | 默认 `qwen2.5:14b`；未单独配置的 ollama chat 节点使用 |
| `OLLAMA_MODEL_INTAKE_COORDINATOR` | 否 | 仅入口接线员在 `CHAT_PROVIDER=ollama` 时使用；不配则等于 `OLLAMA_MODEL` |
| `CHAT_PROVIDER` | 否 | `ollama`（默认）或 `openai`。**须显式写进 `.env`**；仅有 API key **不会**自动切 openai。openai 失败不会回落到本地 14b。覆盖 Intake / Analyst / 摘要 / 全局 B / LangMem / 静默抽记忆 / DAG 填表 |
| `OPENAI_BASE_URL` | `CHAT_PROVIDER=openai` 时建议 | OpenAI 兼容根地址，默认 `https://api.deepseek.com` |
| `OPENAI_API_KEY` / `DEEPSEEK_API_KEY` | `CHAT_PROVIDER=openai` 时必填 | 二选一；DeepSeek 用同一套 Chat Completions |
| `OPENAI_MODEL` | 否 | openai 时 Intake 模型，默认 `deepseek-v4-flash` |
| `OLLAMA_MODEL_EMBED` | 否 | 嵌入模型；不配则 `bge-m3`（1024 维，入库和检索用） |
| `INDEX_EMBED_CONCURRENCY` | 否 | 入库 embed 同时进行的批次数，默认 `3`（上限 16） |
| `INDEX_EMBED_BATCH_SIZE` | 否 | 每批 chunk 数，默认 `8`（上限 64） |
| `QDRANT_URL` | 否 | Qdrant HTTP 地址；不设则由 `QDRANT_HOST` + `QDRANT_PORT` 拼接 |
| `REDIS_ENABLED` / `REDIS_HOST` / `REDIS_PORT` | 否 | 启用 Redis；未设 `REDIS_URL` 且 `REDIS_ENABLED≠1` 时检索 cache 用进程内 memory |
| `REDIS_URL` | 否 | 完整 Redis URL（优先于 HOST+PORT）；路径 `/N` 指定库号，如 `redis://127.0.0.1:6379/2` |
| `REDIS_DB` | 否 | 逻辑库号，默认 `0`（URL 无 `/N` 时生效） |
| `REDIS_KEY_PREFIX` | 否 | Redis key 根前缀，默认 `fambrain`（检索 cache / 限流 / 队列名派生） |
| `DEV_REDIS_AUTO_START` | 否 | `pnpm dev` 时 Redis 不可达且端口空闲则 `docker compose up redis`，默认 `1` |
| `RETRIEVAL_CACHE_DISABLED` / `RETRIEVAL_CACHE_TTL_MS` | 否 | **检索 hits 缓存**（D5-2）；`=1` 关闭；Redis 不可用时 memory fallback |
| `REPEAT_QUESTION_CACHE_DISABLED` | 否 | **同问短路**（`prepare-turn-start/repeat-question-guard.ts`）；`=1` 关闭，同句再问走全链路 |
| `COMPOSITE_ANSWER_CACHE_DISABLED` / `COMPOSITE_ANSWER_CACHE_TTL_MS` | 否 | **槽答案缓存**（composite facet 终稿）（P0-15）；`=1` 关闭 |
| `PIPELINE_QUEUE_ENABLED` | 否 | `1` 时 `pnpm dev` 另起 BullMQ worker（web 入队接好后再开） |
| `OLLAMA_STREAM_THINK` | 否 | 流式是否请求 thinking；不支持时服务端会自动降级重试 |
| `FAMBRAIN_CORPUS_USER_ID` | 否 | 强制所有登录用户检索 `data/doc/users/<此 userId>/`；不设则按用户表 `corpusUserId` 或本人 id |
| `DOC_PARSE_CONCURRENCY` | 否 | DocParser 批量解析并发，默认 `2` |
| `OLLAMA_MODEL_VISION` | 否 | 图片 OCR 视觉模型，默认沿用 `OLLAMA_MODEL`（建议 `llava` 等） |
| `MEM0_ENABLED` / `LANGMEM_ENABLED` | 否 | 记忆层开关，默认 `true` |
| `MEM0_HISTORY_DB_PATH` | 否 | Mem0 操作流水 SQLite，默认 `data/memory/mem0/history.db` |
| `MEM0_QDRANT_COLLECTION` | 否 | Mem0 向量 collection，默认 `fambrain_user_memories`（与语料 collection 隔离） |
| `LANGMEM_SUMMARIZE_AFTER_TURNS` | 否 | 满 N 轮后触发会话摘要，默认 `8` |
| `LANGMEM_KEEP_RECENT_TURNS` | 否 | 摘要后保留最近轮数，默认 `4` |
| `LANGSMITH_API_KEY` | 否 | 配置后启用 LangSmith tracing（亦支持 `LANGCHAIN_API_KEY`） |
| `LANGSMITH_PROJECT` | 否 | 项目名，默认 `fambrain` |
| `LANGSMITH_TRACING` | 否 | 设为 `false` 可关闭（即使已配 Key） |
| `USER_MEMORY_AUTO_LEARN_ENABLED` | 否 | 轮次后静默抽结构化事实 → Mem0，默认 `false` |
| `USER_MEMORY_AUTO_LEARN_MIN_CONFIDENCE` | 否 | 静默写入最低置信，默认 `0.85` |
| `OLLAMA_MODEL_USER_MEMORY_EXTRACT` | 否 | 静默抽取模型；未设则用 Intake / 默认模型 |

单机内存限流不适用于多副本；上生产请在前端网关或 Redis 等侧做统一限流。

## 代码结构（Monorepo）

| 路径 | 职责 |
|------|------|
| `apps/web/` | Next.js UI + BFF；`.next` 产物在此目录 |
| `apps/brain/` | Brain HTTP（FastAPI）。对话、检索、入库、附件抽取都在这里。说明见 [07](./07-python-backend.md) |
| `packages/auth/` | JWT、登录注册、会话 |
| `packages/brain-types/` | `DbChatTurn`、`AgentPipelineContext` 等共享类型 |
| `packages/brain-config/` | Brain 地址与 Chat / Qdrant 环境配置 |
| `apps/web/src/server/chat/handle-post-message.ts` | 存用户消息 → 调 Orchestrator → SSE → 存 assistant |
| `apps/web/src/app/api/conversations/[id]/messages/route.ts` | GET 历史；POST 鉴权后委托 BFF |
| `data/doc/users/<userId>/corpus/` | 可检索履历 Markdown（过渡期既有 md **只读于 HITL**）；新编辑走 `vault/originals/workspace/*.txt` 语料化到 `personal/imports/workspace/`。静默自学 **不写** corpus（默认关） |
| `data/doc/users/<userId>/vault/originals/workspace/` | **用户可编辑原文库**（`.txt` + 文件夹）；系统语料化同步 md/向量 |

**约定：** 网页把会话写在 Prisma；Brain 只通过 HTTP 返回最终 assistant 正文，中间检索不写 `messages`。

**架构演进（2026-07 / 2026-08）：** **PathPlan + planFanOut（LangGraph Send）** 统一有序 `pathPlan.steps[]`（kind=km|list|mem|tool|summarize|dag|vault_workspace）。vault HITL 不在主图：`fileHandoff` 写信封，平级图 `agents/sideline/file`。在线 Chat 走 `completeChat`/`streamChat`（`CHAT_PROVIDER`）；**不接入 Dify**；P0-34 猜意图抬升已清。详见 [架构 v2](./05-architecture-v2-tool-orchestration.md)、[控制面](./06-architecture-control-plane.md)、[坑点 §2.8](./04-pitfalls.md#28-pathplan-统一编排-p0-28--2026-07)、[流程 · 原文库](./02-agent-flows.md)。

## 代码索引

Node 版 `apps/brain-service` 已删除。对话主链在 `apps/brain/packages/agentflow`（`pipeline/execute.py`），检索在 `apps/brain/packages/corpus`，记忆在 `apps/brain/packages/memory`，HTTP 在 `apps/brain/apps/api`。评测：`pnpm eval:brain`（`apps/brain/eval/golden.json`）。网页账号仍在 `packages/db` 的 SQLite。

旧的 verify / e2e / golden 脚本随 Node 服务一起移除。历史设计见 [02](./02-agent-flows.md)、[05](./05-architecture-v2-tool-orchestration.md)、[07](./07-python-backend.md)。

## 旧代码索引（已随 Node 服务删除）

| 技能点 | 代码位置 | 用途 |
|--------|----------|------|
| `runAgentStream` + `runPipelineStream` | `agentflow/`、`pipeline/runtime/orchestrate.ts` + `stream.ts` | HTTP 走双图编排（主图 + 可选文件子线）；`runPipelineStream` 仅主图（eval QA） |
| `runPrepareTurnStart` | `agentflow/agents/online/prepare-turn-start/` | 图首节点：ALS、同问短路、Mem0/LangMem **读** |
| `runPersistTurnEnd` | `agentflow/agents/online/persist-turn-end/` | 图末节点：LangMem **写**、可选静默用户记忆 |
| `getCompiledPipelineGraph` | `pipeline/graph/compile.ts` + `routes.ts` | **prepareTurnStart** → Intake → … → **fileHandoff?** → **persistTurnEnd** → END |
| `userFactNode` / `runUserFactSideNode` / `routeUserFactFromIntake` | `user-fact/`（`index.ts` + `side/`） | remember/recall 主路径；复合路径并行 side-effect |
| `parseIntakeDecision` / `defaultIntakeDecision` | `intake-coordinator/pipeline/parse-intake.ts` | 解析 Intake 路由 JSON；失败 → **clarify**（不发明 retrieve） |
| `runListRetrieverNode` / `runListRetrieveNode` | `corpus-lister/` | 纯 list 短路径 / 复合 list Send 工人 |
| `resolveCompositeCachePlan` / `writeHitsCache` / `slot/execute-sub` / `orderSubResultsBySlots` | `agentflow/cache/` · `knowledge-manager/slot/` · `composite/` | planCacheResolve 读；km 主逻辑在 slot；join 混排 |
| `runKmRetrieveNode` | `knowledge-manager/` | 复合路径 km Send 工人（hybrid 检索 + 规则精排，无 FC） |
| `runPlanSlotJoinNode` / `runPlanMergeNode` | `plan-fanout/` | fan-out 槽汇合 + 与 DAG 线 merge |
| `runPlanSlotPostNode` / `runPlanDagNode` | `plan-fanout/` / `dag-executor/` | Join 后 post-tools / hybrid DAG 工人 |
| `isPureListDecision` | `corpus-lister/route/` | routeAfterIntake → listRetriever 判定 |
| `addStructuredUserFact` / `searchUserFactMemories` | `packages/brain-memory/src/mem0/store.ts` | Mem0 结构化写入 + 按 factKey 语义检索 |
| `completeIntakeCoordinator` | `agentflow/agents/online/intake-coordinator/` | 一次 `completeChat` → 路由 JSON |
| `retrieveKnowledge` | `agentflow/agents/online/knowledge-manager/` | Qdrant hybrid（dense+sparse 引擎 RRF）+ **规则精排**（无 LLM）；见 [km-retrieval-design.md](./km-retrieval-design.md) |
| 全局再规划 B | `agentflow/agents/online/plan-fanout/global-rebatch/` | Join 后结构失败槽补救（替代已删 FactChecker 闭环） |
| `organizeKnowledge` | `agentflow/agents/online/content-organizer/` | hits Zod 规范化 + path 去重 |
| `streamAnalyzeInformation` | `agentflow/agents/online/information-analyst/` | 流式 thinking + assistant |
| `golden:regression` | `apps/brain-service/scripts/golden-regression.ts` | 在线 Agent **G1～G5c + GMem** 全链路回归（`GOLDEN_RUNS=3` 稳定性） |
| `verify:content-organizer` / `verify:agent-schemas` | `apps/brain-service/scripts/` | ContentOrganizer / 全 Agent Zod |
| `verify:embed-batches` | `apps/brain-service/scripts/` | Indexer p-limit 分批逻辑 |
| `verify:memory` / `verify:doc-parser` | `apps/brain-service/scripts/` | Mem0+LangMem / DocParser |
| `preparePipelineMemory` | `packages/brain-memory/`（由 **prepare-turn-start** 调用） | 每轮加载 Mem0 + LangMem → `memoryBlock` |
| `persistPipelineMemory` | `packages/brain-memory/`（由 **persist-turn-end** 调用） | 每轮写 LangMem→Prisma；静默/显式 Mem0 另路径 |
| `ingestDocumentBatch` | `agentflow/agents/offline/doc-parser/` | 批量上传解析 → corpus + 可选入库 |
| `summarizeContent` | `agentflow/agents/online/content-summarizer/` | 在线摘要分支 + CLI（D9） |
| `listVaultFiles` | `agentflow/knowledge/list-vault-files.ts` | vault 只读列举（MCP 共用） |
| `recallSparseRetrieve` | `packages/corpus/src/vector/recall-keyword-retrieve.ts` | Qdrant sparse 检索（入库 BM25 TF；HY-01） |
| `hybridRecall` | `knowledge-manager/recall/hybrid-recall.ts` | 一次 `searchCorpusHybrid`（Qdrant 引擎加权 RRF；HY-02～03） |
| `fuseRrf` | `knowledge-manager/recall/fusion-rrf.ts` | 进程内 RRF（单测 / 对比脚本；主链已改引擎 RRF） |
| `@fambrain/infra` | `packages/infra/` | Redis 连接、检索 hits 缓存与槽答案缓存、BullMQ 队列、限流；相对 import **不带 `.ts` 后缀**（`packages/infra/tsconfig.json`） |
| `verify:retrieval-cache` | `apps/brain-service/scripts/` | D5-2 检索 hits 缓存 normalize + memory/Redis |
| `verify:repeat-question-smoke` | `apps/brain-service/scripts/` | D5-2 同问短路冒烟（无 Ollama） |
| `verify:recall-compare` | `apps/brain-service/scripts/` | HY-07 三问 vector/sparse/RRF（需 Qdrant） |
| `verify:confidence-tier` | `apps/brain-service/scripts/` | 置信分档单测 + KM live tier |
| `verify:analyst-empty-hits` | `apps/brain-service/scripts/` | P0-12 / D5-5：空 hits skip LLM + insufficientEvidence |
| `verify:intake-coreference` | `apps/brain-service/scripts/` | Intake 多轮指代（JSON peek + 拼接≤1）/ 单字 normalize / repeat · **P0-31** |
| TurnTrace | `packages/db` + `GET .../traces` | 每轮 Pipeline timing/steps/logs 入库；SSE 直播 + 历史回放 |
| `verify:intake-chitchat` | `apps/brain-service/scripts/` | P0-13：chitchat briefReply 模板兜底 + live ×10 |
| `verify:intake-link-lookup` | `apps/brain-service/scripts/` | P0-25：GitHub/对外链接 `external_link` guard + stale multipart 单测 |
| `verify:composite-route` | `apps/brain-service/scripts/` | PathPlan legalize + derive slots（mem/tool/summarize）冒烟 |
| `legalizePathPlan` / `normalizePathPlanSteps` / `deriveCompositeSlotsFromPathPlan` | `intake-coordinator/path-plan/from-llm.ts` | LLM PathPlan → 合法化 + 结构归一 + 派生 slots |
| `verify:composite-incremental` | `apps/brain-service/scripts/` | P0-15：槽答案缓存 + composite 增量 单测 |
| `verify:user-fact` | `apps/brain-service/scripts/` | P0-16：Intake schema + Mem0 跨会话 QQ remember/recall |
| `resolveEnumerationTarget` | `intake-coordinator/composite/enumeration-target.ts` | plan label/topics → project \| experience 列举分流（P0-21） |
| `query-signals.ts` | `intake-coordinator/signals/` | 问句结构工具：编号/并列/stale multipart 对齐（P0-25） |
| `ENUMERATION_ACTION_PROMPTS` | `corpus-lister/enumeration/`（Intake `enumeration/` re-export） | 列举 UI 按钮 exact-match prompt（P0-26/27） |
| `harmonizeRetrievalPlanQueryTypes` | `intake-coordinator/guards/intake-link-lookup-guard.ts` | 混合问 enum+link 纠偏（P0-27） |
| `maxAnalystHitsForProfile` | `information-analyst/analyst-recall-limits.ts` | Analyst hits 上限与 KM profile 对齐（P0-20） |
| `clear-pipeline-cache.ts` | `apps/brain-service/scripts/` | 清空 检索 hits 缓存 / 槽答案缓存 Redis + 进程 memory；见 `.env.example` 三层 cache 开关 |
| `diagnose-age-query.ts` | `apps/brain-service/scripts/` | 年龄单问：路由 + KM 检索 + 语料字段诊断（需 Qdrant） |
| `eval:run` | `apps/brain-service/scripts/eval/` | Eval MVP：G1～G5c + KM + E2E（**E2E-five-composite**）+ **memProbe/cacheProbe/profileProbe/fiveCompositeProbe**；`--mem-only` → **GMem**；`--profile-only` → **G-履历综合** |
| `verify:user-memory-extract` | `apps/brain-service/scripts/` | 静默用户记忆 schema 合法化 |
| `verify-test-env.ts` | `apps/brain-service/scripts/` | verify 脚本内覆盖 `.env` cache 开关；**勿**在生产入口引用 |
| `TOOL_RUN_IDS` / `invokeTool` | `agentflow/tools/catalog` · `invoke` | 生产工具清单与分发（含 `get_weather` / `search_web` / 年龄年限 / 外链抽取） |
| LangChain StructuredTool | `agentflow/tools/` | 实验 `bindTools` / `verify:langchain-tools`；主链不由模型选工具 |
| `runKmRetrieveNode` / `runListRetrieveNode` | `knowledge-manager` / `corpus-lister` | 复合 Send 工人 |
| `runPlanSlotJoinNode` / `runPlanMergeNode` | `plan-fanout/` | join + merge 编排 |
| `runPlanSlotPostNode` / `runPlanDagNode` | `plan-fanout/` / `dag-executor/` | Join 后 post-tools / DAG 工人 |
| `runUserFactSideNode` | `user-fact/side/` | 复合并行 remember side-effect |
| `compilePathPlan` / `applyPathPlanGuard` | `intake-coordinator/path-plan/` | 旧分桶编译（兼容/测试）；主路径见 `from-llm.ts` |
| `legalizePathPlan` / `normalizePathPlanSteps` / `deriveCompositeSlotsFromPathPlan` | `intake-coordinator/path-plan/from-llm.ts` | LLM PathPlan → 合法化 + 结构归一 + 派生 slots |
| `extract_external_links_from_hits` | `tools/lib/extract-external-links.ts` | 从 hits 抽对外 URL（Intake 只声明 external_link + toolId） |
| `repairRetrievalPlanItems` / `IDENTITY_FIELD_SEARCH` | `intake-coordinator/composite/` | P0-30：schema 合法化 + facet 去重（无口语 labels） |
| `compute_tenure_from_hits` | `tools/lib/compute-tenure.ts` | P0-30：从业年限（简历时间线最早起点） |
| `diagnose-long-composite-career-query` | `apps/brain-service/scripts/` | P0-30：超长复合履历回归 |
| brain-service 单元测试 | `apps/brain-service/tests/` | 勿再写 `src/**/*.test.ts` |
| `isPureSocialUtterance` / `applyPureSocialUtteranceGuard` | `intake-coordinator/signals/`、`guards/intake-chitchat-guard.ts` | 社交词表 **stub 恒 false**（问候走 Intake LLM）；chitchat 仍用 P0-13 模板注入 briefReply |
| `applyEnumerationSlotGuard` | `intake-coordinator/guards/enumeration-list-intent.ts` | P0-26 per-slot 列举 executor |
| `configureLangSmithTracing` | `packages/brain-config/langsmith.ts` | 启动时启用 tracing；`stream.ts` 附加 conversationId 等 metadata |
| `verify:langchain-tools` | `apps/brain-service/scripts/` | Tool 注册 + retrieve / Mem0 / vault invoke 冒烟 |
| `persistUserMemoryAutoLearnAfterTurn` | `agentflow/agents/online/user-memory-extract/` | 轮次后独立 LLM 抽结构化事实 → Mem0（默认关） |
| `golden:regression` | `apps/brain-service/scripts/` | **G1～G5c + GMem** 全链路回归（`GOLDEN_RUNS=3` 稳定性） |
| `indexAllCorpora` | `agentflow/agents/offline/knowledge-indexer/` | 离线 corpus → Qdrant（跳过 README / `_template.md`） |
| `logAgentIn` / `logAgentOut` | `packages/brain-shared/src/agent-log.ts` | 调试：各 Agent 进出日志（含 KnowledgeManager、ContentOrganizer） |
