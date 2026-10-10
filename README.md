# FamBrain

基于 **Next.js（App Router）** 的家庭协作型对话应用：注册登录、成员审核、会话持久化，以及 **多 Agent 聊天闭环**（Intake 结构化工单 → PathPlan 并行取数 → 归纳回答，SSE 流式）。

提示词、schema 与编排都在本仓库；**不接入 Dify**。在线 Chat 由 `CHAT_PROVIDER=ollama|openai` 显式切换（openai 默认 DeepSeek Flash），失败不会静默回落到本地 14b。embed / 图片 OCR / Mem0 向量仍走 Ollama。

## 快速开始

**环境：** Node.js 20+ · **仅使用 [pnpm](https://pnpm.io/)**

```bash
pnpm install
cp .env.example .env
pnpm run db:migrate
pnpm run db:generate
# Chat 用 openai（DeepSeek）时配 OPENAI_API_KEY 或 DEEPSEEK_API_KEY，并设 CHAT_PROVIDER=openai
# embed / OCR 仍需 Ollama，例如：ollama pull bge-m3
# 本地 Qdrant：pnpm run qdrant:server（或 pnpm dev 自动 docker compose up qdrant）
pnpm run dev    # 一键：Qdrant + Redis + Web + Brain Service
```

浏览器访问 [http://localhost:3000](http://localhost:3000)（端口由 `.env` 的 `PORT` 控制）。环境变量与代码结构见 [项目简介](docs/01-project-overview.md)。

开发前请阅读 [`AGENTS.md`](./AGENTS.md)（Next.js 版本与常见教程有差异）。

## 文档

| 文档 | 内容 |
|------|------|
| [01 · 项目简介与技术栈](docs/01-project-overview.md) | 现状、快速开始、脚本、环境变量、代码结构 |
| [02 · Agent 流程图](docs/02-agent-flows.md) | 全链路 / 双图编排 / 单 Agent 实现、SSE 契约 |
| [04 · 坑点清单](docs/04-pitfalls.md) | 行业常见坑 + 本项目踩坑 + 调试 checklist |
| [05 · 架构 v2 工具编排](docs/05-architecture-v2-tool-orchestration.md) | 四类数据源、catalog `invokeTool`、PathPlan、P0-34 已清 |
| [06 · 控制面](docs/06-architecture-control-plane.md) | 槽状态机、全局 B、文件 HITL、阶段 0～8（Chat 可切换，无 Dify） |
| [KM 检索设计](docs/km-retrieval-design.md) | Qdrant hybrid RRF、queryProfile、`topics`→`docKind` |
| [07 · Python 后端](docs/07-python-backend.md) | `apps/brain`：FastAPI、PostgreSQL、同一份 golden 评测 |

**测试：** `pnpm test:all`（依赖树校验 + 单元测试）· `pnpm test:unit` · `pnpm check:deps` · Brain：`pnpm test:brain` · `pnpm eval:brain`

## 常用命令

```bash
pnpm run dev              # 一键：Qdrant + Redis + Web + Python Brain
pnpm run dev:web          # 仅 Web BFF
pnpm run dev:brain        # 仅 Python Brain（监听 BRAIN_SERVICE_PORT，现有 .env 为 :3001）
pnpm test:brain           # Python pytest
pnpm eval:brain           # Python 跑 apps/brain/eval/golden.json
pnpm run redis:server     # 单独 Docker 起 Redis
pnpm run qdrant:server    # 单独 Docker 起 Qdrant
pnpm run build            # db generate + standalone 打包
pnpm run pack:deploy      # 本地构建并打 tar 部署包
pnpm run docker:up        # Docker 一键启动 web + brain + qdrant + redis
pnpm run index:corpus     # 离线语料入库（Python）
```

## Monorepo 结构

```text
apps/web/             Next.js UI + BFF（output: standalone）
apps/brain/           Brain HTTP（FastAPI，监听 BRAIN_SERVICE_PORT；见 docs/07）
packages/db/          Prisma + 会话（网页登录仍用这份 SQLite）
packages/auth/        JWT / 登录注册 / 会话
packages/brain-types/ 网页与 BFF 共用的对话类型
packages/brain-config/ Brain 地址与 Chat / Qdrant 环境配置
```

语料目录：`data/doc/users/<userId>/corpus/` · SQLite：`packages/db/prisma/dev.db` · 向量：本机 Qdrant（语料 dense+sparse，Mem0 dense-only）
