# Python 后端

[← 返回 README](../README.md)

`apps/brain` 是 Brain 服务。它监听 `BRAIN_SERVICE_PORT`（`.env` 里现有的 3001 会直接用上）。网页登录仍写 Prisma SQLite；Python 用同一把 `JWT_SECRET` 认出里面的 cuid 账号。

## 技术栈

| 层 | 选型 |
|---|---|
| 语言 / 工具 | Python 3.13、uv、ruff |
| HTTP | FastAPI、uvicorn。SSE 帧与 Node 一致：`event` / `data` / `\n\n` |
| 配置 | pydantic-settings，读仓库根 `.env` |
| 数据 | Prisma SQLite（`DATABASE_URL`），与网站同一份库 |
| 缓存 / 队列 | Redis、Taskiq |
| 认证 | 只校验网站签发的 JWT（HS256，cookie 名 `fambrain_token`），再按 id 读 SQLite 里的用户 |
| 日志 | structlog |
| 编排 | Intake JSON → PathPlan。聊天走 `CHAT_PROVIDER=ollama\|openai`，openai 默认 DeepSeek |
| 检索 | 按 `queryType` / topics 收窄文档类型后做词法检索。Qdrant collection 名仍是 `fambrain_corpus_<userId>` |

账号和会话由网站写在 Prisma SQLite（`DATABASE_URL`）。Python 只按 JWT 里的用户 id 读取 `User`，不提供注册、登录或会话接口。

## 目录

```text
apps/brain/
├── apps/api/                 # fambrain_api：HTTP
├── apps/worker/              # fambrain_worker：Taskiq，语料入库
├── packages/kernel/          # 配置、认证、Redis
├── packages/corpus/          # 路径、文档类型、Qdrant hybrid、切分入库
├── packages/memory/          # 结构化事实 + Qdrant 记忆
├── packages/agentflow/       # Intake、PathPlan 执行、工具
├── scripts/run_eval.py
└── tests/
```

引用方向：`fambrain_api` / `fambrain_worker` → `fambrain_agentflow` → `fambrain_corpus` / `fambrain_memory` → `fambrain_kernel`。

仓库根的 `packages/*` 仍是 Next.js 用的 TypeScript 包。Python 后端不从那里 import。

## 本地运行

需要 [uv](https://docs.astral.sh/uv/) 和 Python 3.13（`uv sync` 会自己装解释器）。

```bash
cd apps/brain
uv sync --all-packages --group dev
uv run pytest -q
uv run python scripts/run_eval.py   # 同一份 golden.json
uv run fambrain-api          # 端口 = BRAIN_SERVICE_PORT（.env 里是 3001）
```

仓库根也可以：

```bash
pnpm test:brain
pnpm eval:brain
pnpm dev:brain
```

账号库就是仓库里的 Prisma SQLite（`.env` 的 `DATABASE_URL`）。不需要再起一份 Postgres。

## 已接通

| 接口 | 行为 |
|---|---|
| `GET /health` | 进程、数据库 `SELECT 1`、Redis（配了才 ping） |
| `POST /pipeline/stream` | Bearer JWT。`actorUserId` 必须等于 token 里的用户。SSE 事件含 `step`、`assistant`、`assistant_message`、`pipeline_timing`、`pipeline_done` |
| `POST /pipeline/cancel` | 按 `turnId` 取消；没有这个 turn 时 `aborted: false` |
| `POST /pipeline/pause` | 按 `turnId` 暂停；没有这个 turn 时 `paused: false` |
| `POST /documents/extract` | 聊天附件抽文本，返回 `batchId` |
| `POST /documents/upload` | 写入该用户语料目录，并按需重建 Qdrant |
| `POST /enumeration/list` | `listKind=project\|experience` 分页列举 |

对话主链读 Intake 的结构化 JSON（同一份 `prompt.txt`，从 Node 的 Intake prompt 抽出）。代码只做 schema 合法化，再按 `kind` / `queryType` / `identityField` / `toolId` 执行。不按问句口语猜意图。

| 步骤 | Python 行为 |
|---|---|
| km | 集合在线时走 Qdrant dense + sparse、RRF（权重 0.85 / 1.2），并按 `queryType` 滤 `docKind`。集合不在或查询失败时扫 markdown |
| list | 扫 `corpus/experience` 或 `corpus/projects`。全部槽都是 list 时不发 `plan_merge` |
| mem | 精确字段写 `data/memory/py/facts.json`，同时写入 Qdrant `fambrain_user_memories`（`MEM0_ENABLED` 关闭则跳过向量） |
| tool | 天气（Open-Meteo）、翻译、年龄、身份字段、外链 |
| dag | 按节点顺序执行 `retrieve_corpus` → `translate_text` → `synthesize_merge` |
| vault | 在该用户的 `vault/originals/workspace` 里做 list / open / 创建 / 改 / 删 |

纯闲聊、澄清、越界不进 analyst。`compute_age_from_hits` 从 excerpt 里的日期算年龄。`identityField` → `toolId` 在 `fambrain_agentflow/tools/catalog.py`。

评测读 `apps/brain/eval/golden.json`。报告写到 `reports/py-eval-report.md`。

```bash
pnpm eval:brain
# 或
cd apps/brain && uv run python scripts/run_eval.py --case G1,G2,K1
```

Taskiq 任务 `index_corpus` 按 `##` 切 markdown，用 `OLLAMA_MODEL_EMBED`（默认 `bge-m3`，1024 维）写入 `fambrain_corpus_<userId>` 的 dense + sparse。换模型后要删掉旧集合再整库重嵌。

## 还没做完的部分

- 用户事实的精确召回仍以 JSON 为准；向量记忆是同一条 remember 的第二份，不是 mem0 SDK 的抽取链路。
- PDF / Office 走 Docling Serve（`docker compose up -d docling`，默认 `http://127.0.0.1:5001`）。markdown 和 txt 直接读原文。本机 Intel Mac 的 Python 3.13 没有 PyTorch 轮子，所以不把 docling 装进 venv。
- 文件 HITL 还没有 `jobId` 暂停后恢复，所以 golden 里的 vaultWorkspace 探测没跑。`POST /pipeline/pause` 只把当前 turn 标成暂停。
- 同问缓存、列举「更多」续页游标、`synthesize_merge` 的 free 夹具探测也没跑。
- 网页对话打到 `BRAIN_SERVICE_URL`。Python 监听同一个 `BRAIN_SERVICE_PORT`，现有账号不用迁。
