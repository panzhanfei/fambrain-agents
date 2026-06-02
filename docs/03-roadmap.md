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
4. **（可选自动化）** `cd apps/agents && pnpm run verify:fact-checker && pnpm run verify:fact-checker:pipeline && pnpm run verify:content-organizer && pnpm run verify:agent-schemas && pnpm run verify:embed-batches && pnpm run verify:doc-parser`

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
| `DocParser` | 文档解析师 | 触达 | **✅ D7**（PDF/Word/PPT/图片批量上传→解析→入库） | [§7](./02-agent-flows.md#7-docparser--文档解析师d7) |
| `ContentSummarizer` | 内容摘要师 | 触达 | ⬜ D9 | — |

### P1 要完成的 Agent（任务 × 技术）

| 优先级 | Agent | 交付 | 主要技术 |
|--------|-------|------|----------|
| **P0 必验收** | 知识入库师 | CLI 全量入库 | LlamaIndex、ChromaDB、Ollama Embed、Zod、Pino |
| **P0 必验收** | 知识管理员 | 向量为主 + 关键词 fallback | LangChain、LlamaIndex、ChromaDB、LangSmith |
| **P0 必验收** | 事实核查员 | **检索后**审 `hits`/`coverage`；`passed=false` 时改写 `searchQuery` 并**最多再检索 1 次**；生成后 citation 校验待后续 | LangGraph、ChatOllama、规则兜底、**Zod** |
| **P0 必验收** | 内容整理师 | hits **path 去重**、excerpt 合并、Zod 规范化；Analyst citations 去重 API | Zod、`organizeKnowledge` |
| **P0 必验收** | 编排层 | `runPipelineStream` → `StateGraph`（含 **contentOrganizer** 节点） | LangGraph、LangSmith |
| **P1 增强** | 入口接线员 / 信息分析师 / KM / FactChecker | 在线 Agent JSON **已 Zod 化**（`verify:agent-schemas`） | LangChain、Zod |
| **P1 触达** | 文档解析师 / 内容摘要师 | 最小单路径样例 | Docling、p-limit、Ollama |
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
| D8 | 记忆/对比触达 | — | Mem0 / LangMem；Recall 对比 | ⬜ |
| D9 | 扩展触达 | 内容摘要师；MCP | Vercel AI / MCP 实验 | ⬜ |
| D10 | 回归 + 文档 | 全链路 | A1～T2、G1～G5（**不含消坑**） | 进行中 |

> **风险：** 10 天内 17 项全 ✅ 不现实；**验收以 A1～A6、T1 必做项、T2 为准**。
>
> **消坑节奏：** D7～D10 只做 **Agent 触达 + 基础回归**；KM 空 hits、跨轮重复检索等 **集中消坑** 放在 **核心 Agent 全部接完后** 的独立 sprint（约 4～5 天），见 [坑点 §三 · 集中消坑计划](./04-pitfalls.md#三集中消坑计划核心-agent-完成后--4-天)。顺序：消坑 D1～D4（KM / 召回 / 多轮 / 回归）→ **消坑 D5-消坑**（跨轮 cache，**最后做**）。

### P1 验收标准

| # | 类别 | 验收项 | 通过标准 | 状态 |
|----|------|--------|----------|------|
| A1 | Agent | 知识入库师 | 入库后 Chroma 有记录；重复执行幂等 | **✅ 已通过** |
| A2 | Agent | 知识管理员 | 口语问法 vector hits ≥1，`path` 在 `corpus/` 下 | **🔄** 向量已接；Golden 待回归 |
| A3 | Agent | 事实核查员 | 无 hits 不编造；打回后最多再检索 1 次；`retryCount≥1` 强制放行 | **🔄** 脚本 `verify:fact-checker` / `verify:fact-checker:pipeline` 已通过；Golden 待回归 |
| A4 | Agent | 内容整理师 | hits path 去重；`dedupeCitations`；脚本 `verify:content-organizer` | **✅** 脚本已通过；Golden 待回归 |
| A5 | 编排 | LangGraph | 节点 ≥6（含 factChecker、**contentOrganizer**）；checker→retrieval 条件边；SSE `fact_checker` / **`content_organizer`** | **✅** 图与 step 已接 |
| A6 | 回归 | P0 能力 | [P0 自测 3 条](#p0-自测) + G1～G5 共 8 条，**≥7 条通过** | 进行中 |
| A7 | Agent | 文档解析师 | 批量上传 PDF/Word/PPT/图片 → corpus md + 可选 Chroma；`verify:doc-parser` | **✅** 脚本已通过 |
| T1 | 技术 | 17 项总表 | 1～6、14 为 ✅；12 或 13 至少其一 ✅；7～11、15～17 触达 | 进行中 |
| T2 | 技术 | 可观测 | 1 次完整链路 trace 或结构化日志 | 部分（Pino 入库） |
| D1 | 文档 | docs 更新 | Agent 表与 17 项 ✅/⬜ 同步 | **🔄** 2026-06-02 同步 D7 / DocParser / 批量上传入库 |

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
| 7 | Mem0 | 高级记忆 | 跨会话语义记忆 | ⬜ | 多轮仅靠 DB messages |
| 8 | Docling | 文档解析 | PDF/DOC 预处理 | **🔄 触达** | **DocParser** 以 pdf-parse / officeparser / Ollama OCR 落地（Docling 对照见 P2） |
| 9 | Vercel AI SDK | 轻量 AI SDK | 流式、多模型 | ⬜ | 主链仍自研 SSE |
| 10 | Agno | 轻量多 Agent | 对比 LangGraph | ⬜ | 实验目录 |
| 11 | LangMem | 记忆增强 | 会话摘要、压缩 | ⬜ | 未用 |
| 12 | LangSmith | 链路追踪 | 可视化执行链 | ⬜ | 调试用 `agent-log` |
| 13 | Pino | 日志框架 | 结构化运行日志 | ✅ | 知识入库师 `indexerLogger` |
| 14 | p-limit | 并发控制 | 限制 embed 并发 | ✅ | Indexer `addDocumentsWithEmbedLimit`（`INDEX_EMBED_CONCURRENCY` / `BATCH_SIZE`） |
| 15 | TypeBox | 结构校验 | Zod 替代学习 | ⬜ | 实验对比 |
| 16 | MCP SDK | 模型上下文协议 | 标准化工具交互 | ⬜ | 未接入应用 |
| 17 | Recall | 轻量 RAG | 对比 LlamaIndex | ⬜ | 实验对比 |

**统计（2026-06-02）：** ✅ **9 项**已接入或部分接入（Ollama、Zod、LangChain、LangGraph、LlamaIndex、ChromaDB、p-limit、Pino、LangChain 核心调用）。

### P1 技术覆盖计划（17 项 × 触达方式）

| 序号 | 技术 | P1 目标 | 优先级 | 触达方式 |
|------|------|---------|--------|----------|
| 1 | LangChain | 加深 | **P0** | StructuredTool 包装检索/解析；KM/Checker invoke |
| 2 | LangGraph | 接入 | **P0** | StateGraph + conditional edges；SSE step |
| 3 | LlamaIndex | 接入 | **P0** | `asRetriever()` 供 KM |
| 4 | ChromaDB | 接入 | **P0** | 按 corpusUserId 分 collection |
| 5 | Ollama | 保持 | **P0** | chat + embed；7b/14b 分角色 |
| 6 | Zod | 加深 | **P0** | 全部 Agent JSON 过 schema |
| 7 | Mem0 | 触达 | P1 | 用户偏好 1 条读写 |
| 8 | Docling | 触达 | P1 | DocParser 多格式解析 → Indexer（pdf-parse / officeparser） |
| 9 | Vercel AI SDK | 触达 | P1 | experiments 对比，主链仍 SSE |
| 10 | Agno | 触达 | P2 | 独立实验 |
| 11 | LangMem | 触达 | P1 | 长会话摘要压缩 1 处 |
| 12 | LangSmith | 触达 | **P0** | 与 Pino 至少落地其一 |
| 13 | Pino | 触达 | **P0** | 部分 agent-log 迁移 |
| 14 | p-limit | 接入 | **P0** | Indexer embed 并发限制 |
| 15 | TypeBox | 触达 | P2 | schema 对比实验 |
| 16 | MCP SDK | 触达 | P1 | 只读列 vault 文件 |
| 17 | Recall | 触达 | P1 | 同 query 对比 topK |

### LangChain 子能力 checklist

| 子能力 | 优先级 | 验收 |
|--------|--------|------|
| ChatOllama / Message | P0 | 已有，保持 |
| StructuredTool / DynamicTool | P0 | ≥2 个 Tool |
| StructuredOutputParser / Zod | P0 | 全部 Agent JSON 过 schema ✅ |
| bindTools（可选） | P1 | 1 个试验路由 |
| ConversationSummaryBuffer / LangMem | P1 | 长对话 1 条用例 |

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
| **P0 已落地** | `runPipelineStream`、关键词 RAG、`coalesceRetrieval` | P0-1～10 |

**口述建议：** 先讲 17 项里已 ✅ 的 **9 项** + P0 踩坑 **5～6 条**，再带「其余见 P1/P2 路线图」。
