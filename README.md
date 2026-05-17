# FamBrain / Agent

基于 **Next.js（App Router）** 的家庭协作型对话应用骨架：内置注册登录、账号审核、会话与消息的数据模型，以及聊天界面。**多 Agent + RAG 流水线按阶段迭代中**（见下文路线图）。

## 技术栈

| 层级 | 选型 |
|------|------|
| 框架 | Next.js 16、React 19 |
| 数据库 | SQLite + Prisma 7（客户端生成至 `src/generated/prisma`） |
| 校验 | Zod |
| 认证 | httpOnly Cookie + JWT（`jose`）、密码哈希（`bcryptjs`） |

开发本仓库前，请先阅读根目录 [`AGENTS.md`](./AGENTS.md)：当前 Next.js 与常见教程版本存在差异，以 `node_modules/next/dist/docs/` 为准。

## 快速开始

**环境：** Node.js 20+（推荐与 CI / 部署一致）。

```bash
npm install
cp .env.example .env
# 生产环境请务必设置足够长的 JWT_SECRET（见下表）
npm run db:migrate
npm run db:generate
npm run dev
```

浏览器访问 [http://localhost:3000](http://localhost:3000)。

- **首个注册用户**会成为 `ADMIN`；其余成员默认 `PENDING`，需具备「成员审核」权限的账号在 `/admin/users` 通过后变为 `ACTIVE` 才可进入主界面。
- **聊天区**：侧栏会话与历史消息来自数据库；输入框发送目前仅在浏览器内追加用户消息，**尚未**接入消息持久化接口与模型回复——这将由后续 Agent 编排接入。

## npm 脚本

| 命令 | 说明 |
|------|------|
| `npm run dev` | 本地开发 |
| `npm run build` / `npm run start` | 构建与生产启动 |
| `npm run lint` | ESLint |
| `npm run db:generate` | 生成 Prisma Client |
| `npm run db:migrate` | 开发环境迁移 |
| `npm run db:push` | 无迁移文件时推送 schema（慎用） |
| `npm run db:studio` | Prisma Studio |

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
| `OLLAMA_BASE_URL` / `OLLAMA_MODEL` | 预留 | 本地模型服务（接入 Agent 时使用）；当前业务代码未读取 |

单机内存限流不适用于多副本；上生产请在前端网关或 Redis 等侧做统一限流。

## 多 Agent 路线图（产品里程碑）

目标：**先跑通最小闭环，再加深质量与文档流水线**，每一步都可演示。

### P0 — Week 1：最小闭环

| 英文名 | 中文名 | 职责 |
|--------|--------|------|
| `IntakeCoordinator` | 入口接线员 | 接收输入、理解意图、拆分任务、分发下游 |
| `KnowledgeManager` | 知识管理员 | 检索知识库，返回相关片段（RAG 检索） |
| `InformationAnalyst` | 信息分析师 | 对检索结果分析、归纳并回答 |

**里程碑：** 用户提问 → 意图识别 → 检索 → 分析 → 回答。

### P1 — Week 2：深度与可靠性

| 英文名 | 中文名 | 职责 |
|--------|--------|------|
| `FactChecker` | 事实核查员 | 校验分析结论与证据，矛盾时触发重查 |
| `ContentOrganizer` | 内容整理师 | 结构化输出、来源标注与可追溯 |
| `DocParser` | 文档解析师 | PDF / Word / PPT / 图片等解析为纯文本 |

**里程碑：** 多 Agent 协作 + 事实核查循环；处理幻觉、格式与重试。

### P2 — Week 3：锦上添花

| 英文名 | 中文名 | 职责 |
|--------|--------|------|
| `ContentSummarizer` | 内容摘要师 | 摘要、标签与分类 |
| `KnowledgeIndexer` | 知识入库师 | 分块、向量化、写入向量库 |

**里程碑：** 文档上传完整流水线就绪。

### Week 4

踩坑调优 + 前端调试 / 可观测面板 → **可面试演示版本**。

---

仓库包名为 `agent`，界面品牌为 **FamBrain**；二者指同一应用。
