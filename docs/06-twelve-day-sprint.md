# 12 日冲刺计划 — 复盘 · 治理 · 上云 · 多模型

[← 返回 README](../README.md) · [路线图](./03-roadmap.md) · [流程图](./02-agent-flows.md) · [坑点](./04-pitfalls.md)

**周期：** 12 个自然日（1 人主力）  
**目标：** 完成后在 **「全栈 Agent 应用层」** 候选人中具备 **较为稀缺的工程组合** — 可独立交付 **可部署、可回归、可观测、可切换 LLM 后端** 的 Agent 产品，并用 **数据 + 文档 + 线上 Demo** 证明。

**原则：**

1. **不大改主链架构** — 治理期以度量、文档、小优化、可配置为主。  
2. **Golden / eval 先行** — 每日改完必跑；基线不可回退。  
3. **Ollama 为默认 CI** — OpenAI 为可配置生产选项；两套 smoke 都要绿。  

---

## 一、12 日总览

| 天 | 主题 | 核心交付 |
|:--:|------|----------|
| **D1** | 基线冻结 + 全链路复盘 | baseline 报告；一页纸架构图 |
| **D2** | 离线链路复盘 | Indexer / DocParser / corpus 笔记 |
| **D3** | **LLM 提供方可配置（设计 + 骨架）** | `LLM_PROVIDER`；chat 工厂接口 |
| **D4** | **OpenAI 接入 + smoke** | Intake/FC/Analyst 走 OpenAI；`.env.example` |
| **D5** | Eval 体系化 | CI 门禁；`baseline.json`；分层 verify |
| **D6** | 线上 SLA + 可观测 | `docs/slo.md`；health 聚合；故障演练 |
| **D7** | 成本 / 延迟治理 | p50/p95 + tokens 表；1～2 项优化 before/after |
| **D8** | 团队规范 | `CONTRIBUTING.md`；PR / 发布 checklist |
| **D9** | 硬坑 + Web 手测 | P0-10 等待修项；10 条手测清单 |
| **D10** | 稳态回归 + 口述稿 | Golden×3 + eval；30 分钟口述大纲 |
| **D11** | **云部署** | Docker 上云；HTTPS；生产 `.env` |
| **D12** | **压测 + 总复盘 + Demo** | 压测 1 页；录屏；L3→L4 自评 |

---

## 二、稀缺性验收（D12 必须齐）

| # | 硬货 | 验收标准 |
|---|------|----------|
| 1 | 基线报告 | Golden 7/7×3；eval 13/13；含 p50/p95、tokens/轮、日期 |
| 2 | Eval 门禁 | 合并前 golden + 快 verify 必绿 |
| 3 | SLO 文档 | 指标 + 测量 + 一次 Ollama 宕机演练记录 |
| 4 | 治理一页纸 | 延迟瓶颈 + 优化对比；cache/模型开关策略 |
| 5 | **多 LLM 后端** | `LLM_PROVIDER=ollama\|openai` 切换；各 1 条 smoke 通过 |
| 6 | 云上演示 | 公网/IP 可访问；5 分钟录屏（含 LangSmith） |
| 7 | 压测摘要 | 5～10 并发；p95、错误率、瓶颈结论 |
| 8 | 总复盘 | 全链路图 + 坑点同步 + **30 分钟口述稿** |

---

## 三、分日明细

### D1 — 基线冻结 + 全链路复盘

| 上午 | 下午 | 晚间 |
|------|------|------|
| 画全链路（离线 + 在线 + cache + Learning） | 跑 baseline | 记 3 行日志 |

**命令：**

```bash
cd apps/agents
GOLDEN_RUNS=3 pnpm run golden:regression
EVAL_WRITE_REPORT=1 pnpm run eval:run
```

**交付：** `data/eval/reports/baseline-YYYYMMDD.md`；mermaid 或图入库 `docs/`。

---

### D2 — 离线链路复盘

| 内容 | 验证 |
|------|------|
| KnowledgeIndexer → Chroma metadata | `pnpm run index:corpus` |
| DocParser → corpus imports | `pnpm run verify:doc-parser` |
| `@fambrain/corpus` 路径约定 | 对照 [02-agent-flows §1](./02-agent-flows.md) |

**交付：** 离线笔记 1 篇（可并入总复盘）；确认「在线 hits 从哪来」。

---

### D3 — LLM 提供方可配置（设计 + 骨架）

**背景：** 当前在线 Agent 均硬编码 `ChatOllama`（Intake / FC / Analyst / Summarizer / LangMem 等）。上云后需 **OpenAI（或兼容 API）** 与本地 Ollama **可切换**。

**目标架构（规划，D3 落地骨架）：**

```text
packages/agent-config/
  llm-provider.ts      # LLM_PROVIDER=ollama | openai
  createChatModel()    # 返回 LangChain BaseChatModel

.env
  LLM_PROVIDER=ollama          # 默认，与现网一致
  OPENAI_API_KEY=              # openai 时必填
  OPENAI_BASE_URL=             # 可选，兼容 Azure / 代理
  OPENAI_MODEL=                # 默认 gpt-4o-mini 或等价
  OPENAI_MODEL_INTAKE=         # 可选分角色
  # embed 首期仍 Ollama nomic-embed-text（或 D4+ 再加 OPENAI embed）
```

**改造面（按优先级）：**

| 优先级 | 模块 | 文件 |
|--------|------|------|
| P0 | Intake | `intake-coordinator/ollama-chat.ts` → `createChatModel("intake")` |
| P0 | FactChecker | `fact-checker/check-facts.ts` |
| P0 | Analyst 流式 | `information-analyst/stream*.ts` |
| P1 | ContentSummarizer | `content-summarizer/summarize.ts` |
| P1 | LangMem 摘要 | `packages/agent-memory/langmem/session.ts` |
| P2 | bindTools 实验 | `experiments/bind-tools-react.ts` |
| — | Embed / 入库 | **保持 Ollama** 直至单独排期（避免 D3 范围爆炸） |

**交付：** `createChatModel` 工厂 + 单元测试（mock）；文档本节状态 ⬜→🔄。

---

### D4 — OpenAI 接入 + smoke

| 任务 | 说明 |
|------|------|
| 接入 `ChatOpenAI`（`@langchain/openai`） | 与 Ollama 共用同一 invoke/stream 契约 |
| 更新 `.env.example` | `LLM_PROVIDER`、`OPENAI_*` |
| smoke 脚本 | `verify:llm-provider` 或扩展现有 golden 子集 |
| LangSmith | OpenAI 跑一轮，trace 可见 |

**验收：**

```bash
LLM_PROVIDER=ollama pnpm run golden:regression    # 必须通过（CI 默认）
LLM_PROVIDER=openai pnpm run golden:regression    # 至少 G1/G2/G4 smoke 或通过全量
```

**注意：** OpenAI 有费用；eval 全量可只在 D4/D10 各跑 1 次，日常 CI 仍 Ollama。

**交付：** 可配置切换 merged；README 增加「生产用 OpenAI」小节。

---

### D5 — Eval 体系化

| 层级 | 内容 | 频率 |
|------|------|------|
| L1 快 | `verify:langchain-tools --schema-only`、`verify:agent-schemas` 等 | 每次 PR |
| L2 中 | `golden:regression`（`GOLDEN_RUNS=1` 日常 / 3 发版前） | 每次 PR |
| L3 慢 | `eval:run` + `EVAL_WRITE_REPORT=1` | nightly / 发版前 |

**交付：**

- `.github/workflows/` 或本地 `scripts/ci-check.sh`  
- `data/eval/baseline.json`（通过率、p95、tokens 快照）  
- eval 报告对比脚本（可选）

---

### D6 — 线上 SLA + 可观测

**`docs/slo.md` 建议指标（单机云主机可达成）：**

| 指标 | 目标 | 测量 |
|------|------|------|
| Agents `/health` | 日可用 ≥99% | cron curl |
| 检索类 E2E p95 | ≤15s | eval + 线上 timing |
| L1 repeat p95 | ≤3s | profileProbe t2 |
| 5xx 率 | <1% | 日志 |
| Golden / eval | 发版 100% | CI |

**任务：** BFF health（可选）；Ollama 宕机演练 1 次并记录。

**交付：** `docs/slo.md`；演练记录 1 段。

---

### D7 — 成本 / 延迟治理

| 步骤 | 动作 |
|------|------|
| 1 | LangSmith + `pipeline_timing` 汇总各节点占比 |
| 2 | 选 1～2 个优化（FC skip、cache 策略、模型分角色） |
| 3 | 同 eval 问法 before/after 对比 p95、tokens |

**交付：** `docs/governance-latency-cost.md`（1 页）；表格含数据。

---

### D8 — 团队规范

| 文件 | 内容 |
|------|------|
| `CONTRIBUTING.md` | 分支、提交、必跑 verify、db/index 约定 |
| `.github/PULL_REQUEST_TEMPLATE.md` 或 `docs/pr-checklist.md` | migrate / golden / env.example |
| 发布流程 | `pack:deploy` → 云 → 回滚 |

**交付：** 新人 30 分钟可 dev + golden（自测一遍）。

---

### D9 — 硬坑 + Web 手测

| 来源 | 动作 |
|------|------|
| [坑点 §按需硬坑](./04-pitfalls.md) | P0-10 corpusUserId、D3-10 等 |
| Web 手测 10 条 | 登录、聊天、repeat、learning、反馈 |

**交付：** 手测 checklist 勾选；能修的坑 PR 合入。

---

### D10 — 稳态回归 + 口述稿

```bash
GOLDEN_RUNS=3 pnpm run golden:regression
EVAL_WRITE_REPORT=1 pnpm run eval:run
# 与 D1 baseline 对比
```

**交付：**

- `docs/interview-narrative-30min.md` 大纲（架构 / 质量 / RAG / 上线 / 多模型）  
- 与 baseline  diff 说明（通过率、latency、tokens）

---

### D11 — 云部署

| 步骤 | 说明 |
|------|------|
| 云主机 | 建议 4C8G+；Ollama 同机或局域网 GPU |
| 编排 | 现有 `docker-compose.yml`；Ollama **外部** `OLLAMA_BASE_URL` 或 **OpenAI** |
| 密钥 | `JWT_SECRET`、`OPENAI_API_KEY` 不进库 |
| 入口 | Nginx 443 或云厂商 LB |
| 数据 | `fambrain-doc` / `fambrain-chroma` volume 备份说明 |

**生产 `.env` 示例：**

```bash
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini
AGENTS_SERVICE_URL=http://agents:3001
CHROMA_SERVER_URL=http://chroma:8000
REDIS_URL=redis://redis:6379
LANGSMITH_API_KEY=...
```

**交付：** 线上 URL；部署 runbook 1 页（`docs/deploy-cloud.md`）。

---

### D12 — 压测 + 总复盘 + Demo

**压测（够用即可）：**

| 场景 | 工具 | 并发 |
|------|------|------|
| `/health` | k6 / autocannon | 50～100 rps × 1min |
| 聊天 POST（带 cookie） | k6 脚本 | **5～10** 并发 |

**记录：** p95、错误率、瓶颈（预期 Ollama/OpenAI 队列）。

**总复盘交付：**

- [全链路图](./02-agent-flows.md) 更新  
- [坑点](./04-pitfalls.md) 开放项同步  
- **L3→L4 自评** 1 页  
- **5 分钟 Demo 录屏**（Web + LangSmith + 可选 OpenAI 切换演示）  
- **稀缺性 8 项硬货**（第二节）逐项勾选  

---

## 四、每日节奏（固定）

```text
上午   建设 / 改代码 / 写文档
下午   Golden + eval（或当日对应 verify）
晚间   3 行：改了什么 · 指标 · 明天一条 P0
```

---

## 五、范围裁剪（12 天不够时）

| 可砍 | 不可砍 |
|------|--------|
| KM Wave E/F rerank | D1 baseline + D5 CI |
| 精美 citation UI | D3/D4 多 LLM（至少 OpenAI smoke） |
| OpenAI embed（入库仍 Ollama） | D6 SLO + D7 治理一页纸 |
| 压测 >10 并发 | D11 上云 + D12 录屏与总复盘 |

---

## 六、完成后对外定位（一句话）

> **全栈 Agent 应用工程师**：独立实现 LangGraph 多 Agent + Hybrid RAG + eval 回归 + SLO/成本治理，**支持 Ollama / OpenAI 可切换**，并完成云部署与压测验证的 FamBrain 级产品。

在 **全栈 Agent 应用层** 招聘池中，目标进入 **前 10%～15% 工程组合**（较为稀缺），而非泛泛「会调 API」。

---

## 七、相关命令速查

```bash
# 基线 / 回归
GOLDEN_RUNS=3 pnpm --filter @fambrain/agents run golden:regression
EVAL_WRITE_REPORT=1 pnpm --filter @fambrain/agents run eval:run

# 治理
pnpm --filter @fambrain/agents run verify:langchain-tools
pnpm run docker:up
pnpm run pack:deploy

# 实验
pnpm run experiment:bind-tools -- --schema-only
```

**状态跟踪：** 每日在本文件末尾或 `docs/sprint-log.md` 追加一行进度（可选）。
