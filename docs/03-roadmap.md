# 版本规划与进度

[← 返回 README](../README.md) · [流程图](./02-agent-flows.md) · [坑点清单](./04-pitfalls.md)

目标：**先跑通最小闭环，再加深质量与文档流水线**，每一步都可演示。

**图例：** **✅** = 已接入或部分接入；**⬜** = 规划/触达，尚未接入主链路。

---

## P0 — 最小闭环（已完成）

| 英文名 | 中文名 | 职责 | 状态 |
|--------|--------|------|------|
| `IntakeCoordinator` | 入口接线员 | 意图路由 JSON | ✅ |
| `KnowledgeManager` | 知识管理员 | 关键词 RAG（D3 接向量） | ✅ P0 |
| `InformationAnalyst` | 信息分析师 | 归纳回答 | ✅ |
| `KnowledgeIndexer` | 知识入库师 | 离线 corpus → Chroma | ✅ 离线 |

### P0 自测

1. 「你好」→ 短回复（闲聊 / `briefReply`）。
2. 「城管平台用了什么技术」→ step「检索知识库…」→ **「核查证据…」** → **「整理证据…」** →「整理回答…」→ 最终回答；无语料时可能二次检索（见 [坑点 D5-1](./04-pitfalls.md)）。
3. Ollama 未启动时应收到 `error` 事件，用户消息仍可能已保存。
4. **（可选自动化）** `cd apps/agents && pnpm run golden:regression && pnpm run verify:fact-checker && pnpm run verify:fact-checker:pipeline && pnpm run verify:content-organizer && pnpm run verify:agent-schemas && pnpm run verify:embed-batches && pnpm run verify:doc-parser && pnpm run verify:memory && pnpm run verify:content-summarizer && pnpm run verify:vault-list`

### Golden 问法（回归）

| 编号 | 用户问法 | 期望 |
|------|----------|------|
| G1 | 你好 | 短回复，不检索 |
| G2 | 我的名字 | 检索 personal/简历，非 clarify |
| G3 | 我做过的项目和掌握的技术 | vector hits ≥2，回答分点（D3 后） |
| G4 | 城管平台用了什么技术 | hits 含对应 project md，有 citation |
| G5 | 那个项目呢？（无上下文） | clarify，且不进入 Analyst 编造 |

---

## P1 — Agent 实战与技术栈覆盖（10 天 · 进行中）

**周期：** 10 个自然日（1 人主力）。**定位：** Agent 开发练习，在 FamBrain 上触达 **17 项技术**；验收以 **必做 Agent + 必接技术** 为准，其余为 **触达级**（最小样例或对比脚本）。

### Agent 进度一览

| Agent | 中文名 | 类型 | 状态 | 流程图 |
|-------|--------|------|------|--------|
| `KnowledgeIndexer` | 知识入库师 | ✅ 已实现 | 离线入库完成（A1）；**p-limit 分批 embed**（`INDEX_EMBED_*`） | [§1](./02-agent-flows.md#1-knowledgeindexer--知识入库师-) |
| `IntakeCoordinator` | 入口接线员 | 维持 + Zod 化 | ✅ P0；**Zod schema**（`intakeRoutingSchema`） | [§2](./02-agent-flows.md#2-intakecoordinator--入口接线员-) |
| `KnowledgeManager` | 知识管理员 | 增强 | ✅ P0 关键词；**D3 接 Chroma 向量**；KM 输出 **Zod** | [§3](./02-agent-flows.md#3-knowledgemanager--知识管理员--p0--d3-向量) |
| `InformationAnalyst` | 信息分析师 | 维持 + Zod 化 | ✅ P0；**Zod schema**（终稿 JSON） | [§5](./02-agent-flows.md#5-informationanalyst--信息分析师-) |
| `FactChecker` | 事实核查员 | 新建 | **✅ D5 已接入**（证据包核查 + **Zod**；跨轮 cache → **消坑 sprint 末段**） | [§4](./02-agent-flows.md#4-factchecker--事实核查员-d5-) |
| `ContentOrganizer` | 内容整理师 | 新建 | **✅ D6 已接入**（hits 去重 / 规范化 → Analyst 前） | [§6](./02-agent-flows.md#6-contentorganizer--内容整理师-d6-) |
| LangGraph 编排 | — | 迁移 | **✅** `pipeline/graph` StateGraph | [P0 在线编排](./02-agent-flows.md#p0-在线编排流程) |
| Mem0 + LangMem | 记忆层 | 触达 | **✅ D8**（跨会话 + 会话摘要 → Intake/Analyst） | [§8](./02-agent-flows.md#8-记忆层--mem0--langmemd8) |
| `DocParser` | 文档解析师 | 触达 | **✅ D7**（PDF/Word/PPT/图片批量上传→解析→入库） | [§7](./02-agent-flows.md#7-docparser--文档解析师d7) |
| `ContentSummarizer` | 内容摘要师 | 在线分支 | **✅ D9**（Intake `summarize_content` → KM? → 摘要师；CLI 保留） | [§9](./02-agent-flows.md#9-contentsummarizer--内容摘要师d9) |
| MCP / Recall / Vercel AI | 实验触达 | 触达 | **✅**（见 [experiments/README.md](../experiments/README.md)） | [§10](./02-agent-flows.md#10-实验触达--mcp--recall--vercel-ai-) |

### P1 要完成的 Agent（任务 × 技术）

| 优先级 | Agent | 交付 | 主要技术 |
|--------|-------|------|----------|
| **P0 必验收** | 知识入库师 | CLI 全量入库 | LlamaIndex、ChromaDB、Ollama Embed、Zod、Pino |
| **P0 必验收** | 知识管理员 | 向量为主 + 关键词 fallback | LangChain、LlamaIndex、ChromaDB、LangSmith |
| **P0 必验收** | 事实核查员 | **检索后**审 `hits`/`coverage`；`passed=false` 时改写 `searchQuery` 并**最多再检索 1 次**；生成后 citation 校验待后续 | LangGraph、ChatOllama、规则兜底、**Zod** |
| **P0 必验收** | 内容整理师 | hits **path 去重**、excerpt 合并、Zod 规范化；Analyst citations 去重 API | Zod、`organizeKnowledge` |
| **P0 必验收** | 编排层 | `runPipelineStream` → `StateGraph`（含 **contentOrganizer** 节点） | LangGraph、LangSmith |
| **P1 增强** | 入口接线员 / 信息分析师 / KM / FactChecker | 在线 Agent JSON **已 Zod 化**（`verify:agent-schemas`） | LangChain、Zod |
| **P1 触达** | 文档解析师 | 批量上传 → corpus + 可选 Chroma | pdf-parse、officeparser、Ollama OCR、p-limit |
| **P1 触达** | Mem0 / LangMem | Pipeline `memoryBlock`；`verify:memory` | Mem0、LangMem、Ollama |
| **P1 触达** | 内容摘要师 | CLI + Zod 结构化摘要 | Ollama、Zod、`verify:content-summarizer` |
| **P1 触达** | MCP / Recall / Vercel AI | 实验脚本（不进主链） | MCP SDK、`recallKeywordRetrieve`、`ai` + `ollama-ai-provider` |
| **P2 延后** | Agno 对比 | `experiments/agno-minimal/` | Agno |

### 十日排期

| 天 | 焦点 | Agent | 技术 | 状态 |
|----|------|-------|------|------|
| D1 | 环境与 Chroma | 知识入库师（骨架） | Chroma、Ollama embed、p-limit | **✅ 完成**（p-limit 分批 embed 2026-06-02） |
| D2 | 分块入库 | 知识入库师（完成） | LlamaIndex、Pino、Zod | **✅ 基本完成** |
| D3 | 检索切换 | 知识管理员 | LlamaIndex retriever、关键词 fallback | **✅ 完成** |
| D4 | LangGraph 迁移 | 编排 | StateGraph、`runPipelineStream` | **✅** |
| D5 | 核查闭环 | 事实核查员 | `completeFactCheck`、checker→retrieval 条件边；**Zod** | **✅ 已接入** |
| D6 | 整理与 schema | 内容整理师 | ContentOrganizer 入图；全 Agent JSON Zod | **✅ 完成** |
| D7 | 解析触达 | 文档解析师 | pdf-parse / officeparser / Ollama OCR；批量上传 API | **✅ 完成** |
| D8 | 记忆/对比触达 | — | **Mem0 / LangMem** 注入 Pipeline | **✅ 完成** |
| D9 | 扩展触达 | 内容摘要师；MCP；Recall；Vercel AI | 离线摘要 + `experiments/` 脚本 | **✅ 完成** |
| D10 | 回归 + 文档 | 全链路 | A1～T2、G1～G5（**不含消坑**） | **进行中** |

> **风险：** 10 天内 17 项全 ✅ 不现实；**验收以 A1～A6、T1 必做项、T2 为准**。
>
> **消坑节奏（2026-06 更新）：** P1 十日开发（D1～D9）已基本完成；**质量冲刺 10 日 + 总复盘 1 日** 见下节 [质量冲刺 — 10 日计划](#质量冲刺--10-日计划2026-06)。原 [坑点 §三 · 集中消坑计划](./04-pitfalls.md#三集中消坑计划核心-agent-完成后--4-天) 的 D1～D5-消坑 / R6 条目并入该计划按天交付。

---

## 质量冲刺 — 10 日计划（2026-06）

**定位：** 在线 Agent 复盘已完成（Intake → KM → FactChecker → ContentOrganizer → Analyst；摘要分支 ContentSummarizer）。本阶段不新增 Agent，专注 **Golden 回归、检索质量、跨轮 cache、系统化 eval、SLO/可观测**，并在第 11 天做全链路总复盘。

**原则：**

1. **Golden 先行** — 先测后改，每日改完跑一遍分数表。
2. **依赖顺序** — Golden 基线 → cache → KM 硬坑 → eval → SLO；**rerank 可砍 scope**，用 path 加权 / topics 引导顶替。
3. **完成标准对齐** [坑点 §三 完成标准](./04-pitfalls.md#三集中消坑计划核心-agent-完成后--4-天)。

### 总览

| 阶段 | 日历 | 焦点 | 对应坑点 / 验收 |
|------|------|------|-----------------|
| 离线复盘 | **第 1 天** | KnowledgeIndexer + DocParser + `@fambrain/corpus` | 搞清语料如何进 Chroma |
| Golden | **第 2～3 天** | G1～G5 自动化 + 基线分数 | D10、A6 |
| Cache | **第 4～5 天** | 检索 cache + Intake 重复问 | D5-2、P0-11、#19 |
| **KM 完善（业界对标 v3）** | **第 6～14 天（Wave A～D）** | [KM v3 主计划表](./km-retrieval-design.md#三主计划表按优先级) Wave A→B→C→D | D3-4/6/7/10、P0-15、R6-1 |
| Eval | **第 8～9 天** | 系统化 eval 脚本 + 报告 | A6 扩展 |
| SLO / 日志 | **第 10 天** | 耗时、token、结构化记录 | #18 待做 |
| **总复盘** | **第 11 天** | 离线 + 在线全链路、坑点表、L4 gap | 文档同步 |

### 第 1 天 — 离线 Agent 复盘

| 顺序 | Agent / 模块 | 路径 | 要搞清什么 | 验证 |
|------|--------------|------|------------|------|
| 1 | **KnowledgeIndexer** 知识入库师 | `agents/offline/knowledge-indexer/` | md 扫描 → 切块 → embed → Chroma；metadata 里 `path`/`title` | `pnpm run index:corpus`、`verify:embed-batches` |
| 2 | **DocParser** 文档解析师 | `agents/offline/doc-parser/` | PDF/Word/PPT/图片 → corpus md → 可选入库 | `pnpm run verify:doc-parser` |
| 3 | **@fambrain/corpus** | `packages/corpus/` | 路径约定、`indexCorpusDocuments`、`searchCorpusVectors` | 对照在线 KM L1a |
| 4（可选） | ContentSummarizer CLI | `summarize:document` | 离线摘要工具，非主链 | `verify:content-summarizer` |

**当日产出：** 离线链路笔记（或复盘摘要）；确认「在线 hits 从哪来」。

### 第 2～3 天 — Golden 回归（D10）

| 交付 | 说明 |
|------|------|
| 脚本 | `scripts/golden-regression.ts`，自动跑 G1～G5 |
| 扩展用例 | **G-工作经历**（4 家公司枚举）；**G4-重复问**（同句再问，为 cache 验收预留）；**G-跨会话记忆**（A 记 QQ → B 问，见 [P0-16 §2.6](./04-pitfalls.md#26-跨会话用户自述事实未召回2026-06--web-联调)） |
| 基线 | 记录首次通过率（目标：**≥4/5**）；**现象先记入** [坑点 §2.5](./04-pitfalls.md#25-golden-day-2-联调实录--问题记录与解决顺序2026-06) / [§2.6](./04-pitfalls.md#26-跨会话用户自述事实未召回2026-06--web-联调)，消坑后再收紧 Golden 断言 |

**参考问法：** 见上文 [Golden 问法（回归）](#golden-问法回归)。

**命令（规划）：**

```bash
cd apps/agents
pnpm run golden:regression   # G1～G5 全链路标准回归
```

### 第 4～5 天 — 检索 cache + 跨轮重复（消坑 D5-消坑）

| 交付 | 改动面 | 通过标准 |
|------|--------|----------|
| **检索结果 cache** | `@fambrain/infra` `retrievalNode`；key = `{REDIS_KEY_PREFIX}:retrieval:v1:{corpusUserId}:{queryType}:{query}`；TTL 可配 | 同会话连续两问 G4 原文，第二次不全量走向量检索 |
| **Intake 重复问识别** | `intake-repeat-guard.ts`；`stream.ts` 入口 + `intakeNode` 开头 | 归一化 user 问与本会话 history 相同 → 复用上轮 assistant 答，跳过 KM/FC/Analyst |
| **FactChecker cache hit** | cache hit 时规则快检（`cache_hit_skip_llm`） | 日志 / SSE 可见 `retrievalCacheHit` |

**状态（2026-06-18）：** ✅ 检索 cache（L2）已接入 pipeline（Redis db=`REDIS_DB` 或 URL `/N`；未配 Redis 时 memory fallback）；✅ FC cache hit 快检；✅ `verify:retrieval-cache` + eval `CACHE-G4-repeat` **1/1**；✅ **Intake 同问短路（L1）** — `findRepeatAnswerInHistory` + `repeatQuestionHit`；✅ `verify:intake-repeat-smoke` / `verify:intake-coreference` repeat 单测

**本地开发（同日）：** ✅ `scripts/dev-all.sh` — `pnpm dev` 自动起/等 Chroma、Redis（`DEV_REDIS_AUTO_START=1` → `docker compose up redis`）、Web、Agents；`REDIS_DB` / `REDIS_KEY_PREFIX` 环境变量化

**坑点：** [§2.2 FactChecker 与跨轮重复检索](./04-pitfalls.md#22-factchecker-与跨轮重复检索2026-06--d5-联调)、P0-11、#19。

### 第 6～14 天 — KM 检索（业界对标 v3 · Wave A～D）

> **设计文档：** [km-retrieval-design.md](./km-retrieval-design.md)（**KM v3 · 业界五层对标**；[§三 主计划表](./km-retrieval-design.md#三主计划表按优先级) 为唯一任务源）  
> **v1 已完成（2026-06）：** 规则精排、无在线 LLM、`ensureNonEmptyHits`（D3-2/3/5、P0-4）— 见 [坑点 §2.1.1](./04-pitfalls.md#211-km-移除在线-llm--规则精排p0-4--d3-2--d3-3--d3-5---已消坑-2026-06)  
> **v2 基线（2026-06）：** KM-01 ✅ topics 分流 · KM-02 ✅ path 去重 · KM-04 ✅ km-config

#### Wave 实施顺序

| Wave | 日历（参考） | 优先级 ID | 动哪些模块 | 验收 |
|------|--------------|-----------|------------|------|
| **A** 规则层收尾 | 第 6～7 天 | P0-1～P0-13（KM-03～16） | KM、scripts | **✅ 2026-06** verify 绿；姓名/列举/技术四问 |
| **B** Hybrid 核心 | 第 8～11 天 | P1-1～P1-7（HY-xx） | KM、**corpus**、scripts | **✅ 2026-06** HY-01～07；并行 + RRF 接入 KM |
| **C** 查询理解上移 | 第 12 天 | P2-1～P2-6（QU-xx） | **Intake**、pipeline、KM | **✅ 2026-06** queryType + 多轮指代（G5/G5b） |
| **D** 置信分档 | 第 13～14 天 | P3-1～P3-7（EV-xx） | KM 必做；FC 建议 | **✅ 2026-06** confidenceTier；FC 高置信快检（tier_skip_llm） |
| **E/F** | 质量冲刺后 | P4、P5 | KM；Organizer/Analyst 可选 | FAQ、rerank、防编造 |

**原则：** Wave A～C **不动** FC / Organizer / Analyst；Wave D 起 FC 可选配合降本。

**不做：** Chat LLM rerank（已砍；精排用 RRF + Cross-Encoder，Wave E）。

**Golden：** Wave A 末跑 G-工作经历；全程 `pnpm run verify:km-retrieve`（KM-07）。

<details>
<summary>原 v2 三日计划（归档，已并入 Wave A）</summary>

| 日 | 焦点 | 现对应 |
|----|------|--------|
| D1 | KM-01～07 | KM-01/02/04 ✅；KM-03/05/06/07 → Wave A |
| D2 | KM-08～12 | Wave A |
| D3 | KM-13～18 | **✅ KM-13～16**；DOC 待补 |

</details>

### 第 8～9 天 — 系统化 eval

**目标：** 从「散落的 `verify:*`」演进为可重复跑的 eval MVP（不必一步到位 MLflow/LangSmith）。

| 交付 | 说明 |
|------|------|
| `scripts/eval/golden.json` | 问法 + 断言（path 含、hits≥N、coverage、无幻觉关键词） |
| `scripts/eval/run-eval.ts` | 调 `runPipelineStream` 或 KM 单测，输出 JSON/Markdown 报告 |
| **最少 4 项指标** | Golden 通过率；candidates>0 但 hits=0 率（→0）；cache 命中率；端到端 `latencyMs` |

**状态：** ✅ 2026-06-18 — cache 接入 `@fambrain/infra`；eval cache **1/1**；✅ **profileProbe `G-履历综合`**（4 轮：综合问 → 同问 L1 → 列举 → **编号子问 t4**）`--profile-only` **4/4**

```bash
pnpm --filter @fambrain/agents run eval:run
pnpm --filter @fambrain/agents run eval:run -- --profile-only   # 仅 G-履历综合（~90s）
EVAL_WRITE_REPORT=1 pnpm --filter @fambrain/agents run eval:run  # 写入 data/eval/reports/
```

**与 A6 关系：** eval 脚本即 A6 的自动化延伸。

### 第 10 天 — SLO + 记录（#18 剩余）

| 项 | 做法 | 优先级 | 状态 |
|----|------|--------|------|
| **逐步耗时** | Pipeline 每节点记录 `latencyMs`（intake / retrieval / fact_checker / analyst） | P0 | 🔄 **2026-06-18** — `pipeline_timing` SSE + `step.done.durationMs` + 聊天 UI |
| **Token 估算** | Analyst 流式结束后记录 prompt/ completion 长度或 Ollama 返回 | P1 | ⬜ |
| **结构化日志** | 每轮一条 JSON：`conversationId`、`steps[]`、`cacheHit`、`issueCodes` | P0 | 🔄 `agent-log` Pipeline 出参含 `timing` |
| **前端** | 引用列表 UI、完整调试面板 | P2 | 🔄 助手消息下「用时 / 首字 / 全链路」 |

**坑点：** [#18 推理黑盒](./04-pitfalls.md) 待做项。

### 第 11 天 — 全面总复盘

| 产出 | 内容 |
|------|------|
| 全链路图 | 离线入库 + 在线编排（含 cache/eval 新节点） |
| 分数对比 | Golden / eval 第 1 天 vs 第 10 天 |
| 坑点表 | 更新 [04-pitfalls.md](./04-pitfalls.md) 中 D3-*、D5-2、R6-* 为 ✅ / 🔄 |
| 能力自评 | L3 → L4 gap 一页纸（eval 闭环、生产就绪度） |
| 文档 | 同步 [02-agent-flows.md](./02-agent-flows.md)、本路线图状态列 |

### 10 日冲刺 — 完成标准（勾选）

- [ ] 离线 Agent 复盘笔记（KnowledgeIndexer + DocParser + corpus 包）
- [ ] Golden **G1～G5 ≥4 条稳定通过**（脚本可重复跑）
- [ ] **D3-2 不可复现**（12 candidates → hits ≥1）
- [x] **D5-2**：同会话 G4 连续两问，第二次命中 L2 cache 或 L1 Intake 复用（两层 ✅ 2026-06-18）
- [ ] **R6-1**：列举型「哪几家公司」→ 4 家且同句再问一致
- [x] **eval MVP**：`run-eval` 输出报告（通过率 + 指标 4 项）— 2026-06-17 12/12
- [ ] **SLO 日志**：每轮至少含 step 耗时；可选 token（**step 耗时 + UI 展示 2026-06-18** ✅ 部分）
- [ ] **R6-3**：同会话综合履历 → **编号子问**公司数不得 4→2（**eval `G-履历综合` 4/4 ✅**；Intake 编号路由 / 冷会话仍 ⬜ ← [坑点 §2.7](./04-pitfalls.md#27-同会话综合履历问-vs-编号子问--答案退化2026-06-18--web-联调)）
- [x] 坑点表与路线图状态已更新（D5-2 L1+L2 / dev 一键 / **R6-3 部分** / SLO 耗时 **2026-06-18**）
- [ ] 第 11 天总复盘文档或会话纪要归档

### 每日建议节奏

```text
上午：实现 / 改坑
下午：跑 Golden + eval，更新分数表
晚间：只记 3 行 — 今天改了什么、通过率、明天一条 P0
```

### 范围裁剪（时间不够时）

| 可砍 | 不可砍 |
|------|--------|
| rerank、前端 citation UI、LangSmith 接入 | Golden 基线、D3-2 coalesce、检索 cache、eval MVP |

---

### P1 验收标准

| # | 类别 | 验收项 | 通过标准 | 状态 |
|----|------|--------|----------|------|
| A1 | Agent | 知识入库师 | 入库后 Chroma 有记录；重复执行幂等 | **✅ 已通过** |
| A2 | Agent | 知识管理员 | 口语问法 vector hits ≥1，`path` 在 `corpus/` 下 | **🔄** 向量已接；Golden 待回归 |
| A3 | Agent | 事实核查员 | 无 hits 不编造；打回后最多再检索 1 次；`retryCount≥1` 强制放行 | **🔄** 脚本 `verify:fact-checker` / `verify:fact-checker:pipeline` 已通过；**Golden** `golden:regression` 基线建立中 |
| A4 | Agent | 内容整理师 | hits path 去重；`dedupeCitations`；脚本 `verify:content-organizer` | **✅** 脚本已通过；Golden 待回归 |
| A5 | 编排 | LangGraph | 节点 ≥6（含 factChecker、**contentOrganizer**）；checker→retrieval 条件边；SSE `fact_checker` / **`content_organizer`** | **✅** 图与 step 已接 |
| A6 | 回归 | P0 能力 | [P0 自测 3 条](#p0-自测) + G1～G5 共 8 条，**≥7 条通过** | 进行中 |
| A7 | Agent | 文档解析师 | 批量上传 PDF/Word/PPT/图片 → corpus md + 可选 Chroma；`verify:doc-parser` | **✅** 脚本已通过 |
| A8 | 技术 | 记忆触达 | Mem0 跨会话检索 + LangMem 会话摘要注入 Intake/Analyst；`verify:memory` | **✅** 脚本已通过 |
| A9 | Agent | 内容摘要师 | `summarizeContent` + CLI；`verify:content-summarizer` | **✅** 脚本已通过 |
| A10 | 实验 | MCP / Recall / Vercel AI | `experiment:*` + `verify:vault-list` | **✅** 脚本已通过 |
| T1 | 技术 | 17 项总表 | 1～9、11、14、16、17 触达/✅；10、15 P2；12 或 13 至少其一待补 | **🔄** LangSmith 待触达 |
| T2 | 技术 | 可观测 | 1 次完整链路 trace 或结构化日志 | 部分（Pino 入库） |
| D1 | 文档 | docs 更新 | Agent 表与 17 项 ✅/⬜ 同步 | **✅** 2026-06-02 含 D9 + 实验触达 |

---

## P2 — 锦上添花

| 英文名 | 中文名 | 职责 |
|--------|--------|------|
| `ContentSummarizer` | 内容摘要师 | 完整上传流水线（若 P1 仅触达） |
| （完善） | 文档解析师 / MCP 写操作 | 多格式、权限、vault 下载 API |

**里程碑：** 文档上传完整流水线；前端可观测面板；Agno/TypeBox 对比报告（可选）。

**Week 4：** 踩坑调优 + 前端调试面板 → **可面试演示版本**。

---

## 技术选型总表（17 项）

| 序号 | 技术名称 | 所属类别 | 核心作用 | 落地 | 落地说明 |
|------|----------|----------|----------|------|----------|
| 1 | LangChain | AI 基础框架 | 模型调用、工具、链式任务 | ✅ | `ChatOllama`、Message（Intake/KM）；Tool/Memory 未用 |
| 2 | LangGraph | 多 Agent 编排 | 状态图、条件分支、循环 | ✅ | `pipeline/graph` StateGraph（Intake → KM → FC → **Organizer** → Analyst） |
| 3 | LlamaIndex | RAG 框架 | 索引、分片、检索 | ✅ | 离线入库 + **在线 `vectorRetrieve`** |
| 4 | ChromaDB | 向量数据库 | Embedding 存储与检索 | ✅ | 离线入库 + **在线检索** |
| 5 | Ollama | 本地模型 | 离线跑开源模型 | ✅ | chat + embed + 流式 thinking |
| 6 | Zod | 结构化校验 | Schema 约束 LLM/API 输出 | ✅ | 注册/会话 + 入库 metadata；**在线 Agent JSON 均已 schema**（`verify:agent-schemas`） |
| 7 | Mem0 | 高级记忆 | 跨会话语义记忆 | **✅ 触达** | `preparePipelineMemory` + `data/memory/mem0/` |
| 8 | Docling | 文档解析 | PDF/DOC 预处理 | **🔄 触达** | **DocParser** 以 pdf-parse / officeparser / Ollama OCR 落地（Docling 对照见 P2） |
| 9 | Vercel AI SDK | 轻量 AI SDK | 流式、多模型 | **✅ 触达** | `experiment:vercel-ai`（`ai` + `ollama-ai-provider`）；主链仍自研 SSE |
| 10 | Agno | 轻量多 Agent | 对比 LangGraph | ⬜ | 实验目录 |
| 11 | LangMem | 记忆增强 | 会话摘要、压缩 | **✅ 触达** | `langmem-session` + `data/memory/sessions/` |
| 12 | LangSmith | 链路追踪 | 可视化执行链 | ⬜ | 调试用 `agent-log` |
| 13 | Pino | 日志框架 | 结构化运行日志 | ✅ | 知识入库师 `indexerLogger` |
| 14 | p-limit | 并发控制 | 限制 embed 并发 | ✅ | Indexer `addDocumentsWithEmbedLimit`（`INDEX_EMBED_CONCURRENCY` / `BATCH_SIZE`） |
| 15 | TypeBox | 结构校验 | Zod 替代学习 | ⬜ | 实验对比 |
| 16 | MCP SDK | 模型上下文协议 | 标准化工具交互 | **✅ 触达** | `experiment:mcp-vault` · 工具 `list_vault_files` |
| 17 | Recall | 轻量 RAG | 对比 LlamaIndex | **✅ 触达** | `recallKeywordRetrieve` + `experiment:recall-compare` |

**统计（2026-06-02）：** ✅ **14 项**已接入或触达（含 **Vercel AI**、**MCP**、**Recall**、**Mem0**、**LangMem**；Docling 以 DocParser 替代触达）。

### P1 技术覆盖计划（17 项 × 触达方式）

| 序号 | 技术 | P1 目标 | 优先级 | 触达方式 |
|------|------|---------|--------|----------|
| 1 | LangChain | 加深 | **P0** | StructuredTool 包装检索/解析；KM/Checker invoke |
| 2 | LangGraph | 接入 | **P0** | StateGraph + conditional edges；SSE step |
| 3 | LlamaIndex | 接入 | **P0** | `asRetriever()` 供 KM |
| 4 | ChromaDB | 接入 | **P0** | 按 corpusUserId 分 collection |
| 5 | Ollama | 保持 | **P0** | chat + embed；7b/14b 分角色 |
| 6 | Zod | 加深 | **P0** | 全部 Agent JSON 过 schema |
| 7 | Mem0 | 触达 | P1 | Pipeline 检索 + 轮次持久化 ✅ |
| 8 | Docling | 触达 | P1 | DocParser 多格式解析 → Indexer（pdf-parse / officeparser） |
| 9 | Vercel AI SDK | 触达 | P1 | `experiment:vercel-ai` ✅ |
| 10 | Agno | 触达 | P2 | 独立实验 |
| 11 | LangMem | 触达 | P1 | 满 N 轮摘要 + Intake 历史裁剪 ✅ |
| 12 | LangSmith | 触达 | **P0** | 与 Pino 至少落地其一 |
| 13 | Pino | 触达 | **P0** | 部分 agent-log 迁移 |
| 14 | p-limit | 接入 | **P0** | Indexer embed 并发限制 |
| 15 | TypeBox | 触达 | P2 | schema 对比实验 |
| 16 | MCP SDK | 触达 | P1 | `list_vault_files` MCP 工具 ✅ |
| 17 | Recall | 触达 | P1 | `experiment:recall-compare` ✅ |

### LangChain 子能力 checklist

| 子能力 | 优先级 | 验收 |
|--------|--------|------|
| ChatOllama / Message | P0 | 已有，保持 |
| StructuredTool / DynamicTool | P0 | ≥2 个 Tool |
| StructuredOutputParser / Zod | P0 | 全部 Agent JSON 过 schema ✅ |
| bindTools（可选） | P1 | 1 个试验路由 |
| ConversationSummaryBuffer / LangMem | P1 | LangMem 会话摘要 + `verify:memory` ✅ |

### 核心技术分项（学习参考）

#### LangChain

| 技术点 | 在 Agent 中的用途 |
|--------|-------------------|
| ChatOllama | 封装 Ollama，支持流式 |
| DynamicTool / StructuredTool | 检索、解析、验证等工具 |
| bindTools | LLM 自主选工具 |
| SystemMessage / HumanMessage | 角色与行为边界 |
| StructuredOutputParser | 解析 LLM 输出 |

#### LangGraph

| 技术点 | 在 Agent 中的用途 |
|--------|-------------------|
| StateGraph | 8 Agent 协作状态图 |
| addConditionalEdges | 意图路由、核查回退 |
| streamEvents / stream | 流式步骤事件 → 前端 |
| MemorySaver | 状态持久化 |

#### LlamaIndex + 向量库

| 技术点 | 在 Agent 中的用途 |
|--------|-------------------|
| VectorStoreIndex | 分块、Embedding、建索引 |
| asRetriever() | Agent 查询知识库 |
| ChromaDB | 向量存储（总表序号 4） |

#### Ollama 模型层

| 模型 | 用途 |
|------|------|
| qwen2.5:7b | 轻量 Agent（KM、Checker、Organizer） |
| qwen2.5:14b | 重量 Agent（Intake、Analyst） |
| nomic-embed-text | 向量化 |

---

## 面试口述索引

| 模块 | 核心技术栈 | 核心坑点（见 [坑点清单](./04-pitfalls.md)） |
|------|------------|---------------------------------------------|
| 推理规划 | LangGraph StateGraph、ConditionalEdges | 意图误判、任务拆分、过早终止 |
| 工具调用 | LangChain DynamicTool、bindTools | 工具选错、死循环、不可解析 |
| 幻觉控制 | FactChecker、ContentOrganizer、向量反向验证 | 信息捏造、断章取义 |
| 多 Agent 协作 | LangGraph 条件回退、ContentOrganizer 去重 | 重复输出、协商死循环 |
| 记忆管理 | SummaryBuffer、共享状态 | 关键信息遗忘、上下文污染 |
| 可观测性 | streamEvents、调试面板 | 推理黑盒（#18 部分 ✅） |
| **P0 已落地** | `runPipelineStream`、关键词 RAG、KM **规则精排**（无在线 LLM） | P0-1～10 |

**口述建议：** 先讲 17 项里已 ✅/触达的 **14 项** + P0 踩坑 **5～6 条**，再带「LangSmith / Agno 见 P2」。
