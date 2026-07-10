# FamBrain

基于 **Next.js（App Router）** 的家庭协作型对话应用：注册登录、成员审核、会话持久化，以及 **P0 多 Agent 聊天闭环**（意图路由 → 知识库检索 → 归纳回答，SSE 流式）。

**当前进度：** 离线入库 ✅；在线 LangGraph ✅；Golden / eval ✅；LangChain Tool + LangSmith ✅；Learning A–D ✅。**下一步：** [12 日冲刺 — 治理 / OpenAI 可配置 / 上云](docs/06-twelve-day-sprint.md)。详见 [路线图](docs/03-roadmap.md) · [坑点](docs/04-pitfalls.md)。

## 快速开始

**环境：** Node.js 20+ · **仅使用 [pnpm](https://pnpm.io/)**

```bash
pnpm install
cp .env.example .env
pnpm run db:migrate
pnpm run db:generate
# 本地对话需 Ollama，例如：ollama pull qwen2.5:14b
pnpm run dev    # 一键：Chroma + Redis + Web + Brain Service
```

浏览器访问 [http://localhost:3000](http://localhost:3000)（端口由 `.env` 的 `PORT` 控制）。环境变量与代码结构见 [项目简介](docs/01-project-overview.md)。

开发前请阅读 [`AGENTS.md`](./AGENTS.md)（Next.js 版本与常见教程有差异）。

## 文档

| 文档 | 内容 |
|------|------|
| [01 · 项目简介与技术栈](docs/01-project-overview.md) | 快速开始、脚本、环境变量、代码结构 |
| [02 · Agent 流程图](docs/02-agent-flows.md) | 全链路 / 在线编排 / 单 Agent 实现、SSE 契约 |
| [03 · 版本规划与进度](docs/03-roadmap.md) | P0/P1/P2、十日排期、17 项技术、验收表 |
| [04 · 坑点清单](docs/04-pitfalls.md) | 行业常见坑 + 本项目 P0 踩坑 + 调试 checklist |
| [05 · 架构 v2 工具编排](docs/05-architecture-v2-tool-orchestration.md) | 四类数据源、ToolOrchestrator/DagExecutor、年龄触发重构 |
| [06 · 12 日冲刺计划](docs/06-twelve-day-sprint.md) | 复盘 / SLA / eval / OpenAI 可配置 / 上云 / 压测 |

**测试：** `pnpm test:all`（依赖树校验 + 单元测试）· `pnpm test:unit` · `pnpm check:deps`

## 常用命令

```bash
pnpm run dev              # 一键：Chroma + Redis + Web + Brain Service [+ Worker]
pnpm run dev:web          # 仅 Web BFF
pnpm run dev:brain-service # 仅 Brain 服务（默认 :3001）
pnpm run redis:server     # 单独 Docker 起 Redis
pnpm run build            # db generate + standalone 打包
pnpm run pack:deploy      # 本地构建并打 tar 部署包
pnpm run docker:up        # Docker 一键启动 web + brain-service + chroma
pnpm run chroma:server    # 启动 Chroma（向量库）
pnpm run index:corpus     # 离线语料入库（apps/brain-service）
pnpm run summarize:document -- path/to.md   # 内容摘要师 CLI
pnpm run experiment:mcp-vault             # MCP 只读列 vault
pnpm run experiment:recall-compare -- <userId> "query"
pnpm run experiment:vercel-ai -- "prompt"
pnpm run experiment:bind-tools -- "我的名字是什么？"
pnpm run experiment:bind-tools -- --schema-only
```

## Monorepo 结构

```text
apps/web/           Next.js UI + BFF（output: standalone）
apps/brain-service/   Brain HTTP 服务 + 多 Agent 编排（默认 BRAIN_SERVICE_PORT=3001）
packages/db/        Prisma + 会话 repo
packages/auth/      JWT / 登录注册 / 会话
packages/brain-*/   types / config / shared / memory 公共代码
```

语料目录：`data/doc/users/<userId>/corpus/` · SQLite：`packages/db/prisma/dev.db`
