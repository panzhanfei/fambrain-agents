# Agent 流程图

[← 返回 README](../README.md) · [坑点清单](./04-pitfalls.md)

本文描述 FamBrain 多 Agent 的 **全局链路**、**在线编排**、**单 Agent 实现**（含规则 / 文件 / 方法），以及路由契约与 SSE 事件。

## 在线 Agent 角色

| 英文名 | 中文名 | 职责 |
|--------|--------|------|
| **`TurnStart`** | **轮次开始** | LangGraph **START 后首节点**（非 LLM）：挂 ALS 记事本、同问短路、Mem0/LangMem 注入 |
| **`TurnEnd`** | **轮次结束** | LangGraph **END 前末节点**（非 LLM）：Mem0/LangMem 写入、Learning 候选 |
| `IntakeCoordinator` | 入口接线员 | 接收输入、理解意图、拆分任务、产出路由 JSON |
| `KnowledgeManager` | 知识管理员 | 检索知识库，返回 `hits` / `coverage` / `notes` |
| `FactChecker` | 事实核查员 | **检索后、生成前**审查证据包；不足时打回再检索（最多 1 次） |
| `ContentOrganizer` | 内容整理师 | **核查通过后**对 `hits` 做 Zod 规范化与 path 去重，再交给分析师 |
| **`ToolOrchestrator`** | **工具编排器** | KM 之后执行确定性工具（年龄计算、列举合成、联网搜索）；产出 `toolResults` |
| **`DagExecutor`** | **DAG 执行器** | 混合问句（`routeMode=dag`）并行语料+联网，汇合后交给 Analyst |
| `InformationAnalyst` | 信息分析师 | 消费 `toolResults` + 整理后的 `hits` 写终稿；无证据时 `insufficientEvidence` |

**链路：** 用户提问 → **轮次开始** → 意图识别 → 检索 → **证据核查** → **内容整理** → 分析 → 回答 → **轮次结束**。跨轮 **两层 cache**（同问短路 + 检索结果 cache）见 [坑点 §2.2](./04-pitfalls.md)。

**架构双线（2026-06）：**

| 线 | 目录 | 编排 |
|----|------|------|
| **在线** | `agentflow/brain-service/online/` + `pipeline/` | LangGraph 骨架（`graph/`）+ SSE 运行时（`runtime/`） |
| **离线** | `agentflow/brain-service/offline/` | 手动脚本：Indexer / DocParser / Learning 等 |

## 全链路总览（离线入库 + 在线对话）

```mermaid
flowchart TB
  subgraph offline ["离线：知识入库师（手动 pnpm run index:corpus）"]
    MD["data/doc/users/*/corpus/*.md"]
    KI["KnowledgeIndexer"]
    CH[("Chroma<br/>fambrain_corpus_&lt;userId&gt;")]
    MD --> KI --> CH
  end

  subgraph ingest ["离线：文档解析师（批量上传 / parse:documents）"]
    UP["PDF / Word / PPT / 图片"]
    DP["DocParser"]
    VAULT["vault/originals/uploads"]
    IMP["corpus/*/imports/*.md"]
    UP --> DP
    DP --> VAULT
    DP --> IMP
    IMP --> KI
  end

  subgraph online ["在线：用户聊天 POST .../messages（LangGraph）"]
    U[用户消息] --> PT[TurnStart<br/>prepare_turn_start]
    PT --> REP{同问短路<br/>repeat guard}
    REP -->|history 命中| OUT[assistant 流式输出]
    REP -->|miss| MEM["preparePipelineMemory<br/>Mem0 + LangMem"]
    MEM --> IC[IntakeCoordinator<br/>入口接线员]
    IC --> P{parseIntakeDecision<br/>LangGraph 路由}
    P -->|remember/recall user_fact| UF[userFact 节点<br/>Mem0 显式读写]
    P -->|clarify / chitchat| R1[briefReply / 澄清]
    P -->|    KM --> FC[FactChecker<br/>事实核查员]
    FC -->|passed 或已重试| CO[ContentOrganizer<br/>内容整理师]
    FC -->|未通过且 retry&lt;1| KM
    CO --> IA[InformationAnalyst<br/>信息分析师]
    P -->|direct_answer 等| FC2[FactChecker 可选] --> CO2[ContentOrganizer] --> IA
    IA --> OUT[assistant 入库]
    UF --> OUT
  end

  CH -.->|向量 hits| KM
  MD -.->|关键词 fallback| KM
```

## 在线编排流程

入口接线员只输出 **JSON 路由决策**；**进哪个节点由 LangGraph 查表决定**（`IntakeRoutingDecision` 见 `agentflow/brain-service/online/intake-coordinator/prompt.ts`），不是模型在回复里写「下一个 Agent 名字」。

**Pipeline 目录（2026-06 方案 2）：**

| 子目录 | 职责 | 关键文件 |
|--------|------|----------|
| `pipeline/graph/` | **LangGraph 骨架**：状态、条件路由、节点注册 | `state.ts`、`routes.ts`、`compile.ts`（~50 行） |
| `pipeline/runtime/` | **SSE 运行时**：初始 state、耗时、stream 消费 | `initial-state.ts`、`pipeline-timing.ts`、`stream.ts` |
| `agents/online/*/` | **节点业务**：各 Agent 的 `*-node.ts` | 见下表 |

实现：`pipeline/graph/compile.ts`（只注册节点 + 连边）· `pipeline/runtime/stream.ts` → `runPipelineStream()`（SSE + 步骤耗时；**不含** Agent 业务逻辑）。

**`runtime/stream.ts` 仅负责：** SSE 推送、`PipelineTimingTracker`、Pipeline 出去日志；**不**含 Mem0 读写或检索 cache 业务。

**D5-2 / P0-15 三层 cache（2026-06 · env 可关）：**

| 层 | 位置 | Key / 条件 | 命中后 | 关闭 |
|----|------|------------|--------|------|
| **同问短路** | **`repeatQuestionGuard` 节点**（`repeat-question-guard/nodes/repeat-question-node.ts`） | `normalize(userQuestion)` + history 中已有 assistant 答 | `repeat_respond_early` → 复用答案（`repeatQuestionHit`）→ `persistTurnEnd` | `REPEAT_QUESTION_CACHE_DISABLED=1` |
| **检索结果 cache** | `knowledge-manager/nodes/retrieval-node.ts`（`runRetrievalNode`） | `{prefix}:retrieval:v1:{corpusUserId}:{queryType}:{normalize(searchQuery)}` | 跳过 KM；仍走 FC / Analyst（`retrievalCacheHit`） | `RETRIEVAL_CACHE_DISABLED=1` |
| **composite 终稿 cache** | `composite-answer-cache.ts` | 同会话 `conversationId` + `corpusUserId` + **facetKey** | composite/slot 增量：命中槽跳过 KM；**slot 单槽**时 Analyst 读 cache 或 citations 还原 hits | `COMPOSITE_ANSWER_CACHE_DISABLED=1` |

清空 Redis / memory：`pnpm --filter @fambrain/brain-service exec tsx --env-file=../../.env scripts/clear-pipeline-cache.ts`（改 env 后须**重启 agents** 清进程内 memory）。

同问短路解决 Intake 非确定性导致「同句再问 searchQuery 变、公司数降级」；检索结果 cache 解决问法不同但 Intake 产出相同 `searchQuery` 的场景（如 eval `CACHE-G4-repeat`）。

```mermaid
flowchart TD
  A[用户消息] --> PT[TurnStart<br/>ALS + 同问短路 + Mem0]
  PT -->|同问命中| D0[respondEarly]
  PT -->|miss| B[IntakeCoordinator]
  B --> C{parseIntakeDecision}

  C -->|clarify / chitchat + briefReply| D[respondEarly]
  C -->|remember_user_fact / recall_user_fact| UF[userFact → Mem0]
  C -->|  C -->|其它需下游| FC0[FactChecker]

  F --> FC[FactChecker]
  FC -->|checkerPassed 或 retryCount ≥ 1| CO[ContentOrganizer]
  FC -->|!checkerPassed 且 retryCount = 0| F
  CO --> G[InformationAnalyst]
  FC0 --> CO0[ContentOrganizer] --> G
  G --> PST[TurnEnd]
  D --> PST
  UF --> PST
  D0 --> PST
  PST --> END_NODE[END]
```

## 单 Agent 实现流程

每个 Agent 一张图 + 步骤表（**规则 / 文件 / 方法**），便于对照代码。

### 0. TurnStart — 轮次开始 ✅

**触发：** 每轮 LangGraph **必经**首节点 `prepareTurnStart`（`START → prepareTurnStart`）。**非 LLM**。

**职责：**

1. `createPipelineRunStore` + `pipelineRunStorage.enterWith` — 本轮 ALS（token 统计 + `pipeline_log` 队列）
2. **同问短路** `findRepeatAnswerInHistory` — 命中 → `exitEarly` + `respondEarly`
3. `preparePipelineMemory` — Mem0 检索 + LangMem 摘要 → 写入 state 的 `memoryBlock` / `intakeHistory` / `userMemories`

**代码：** `agentflow/brain-service/online/prepare-turn-start/` · 图节点 `compile.ts` · SSE step 名 **`prepare_turn_start`**（UI：准备上下文）

**验证：** `pnpm run verify:repeat-question-smoke`（同问短路，无 Ollama）；全链路 `verify:fact-checker:pipeline`（首步 `prepare_turn_start`，末步 `persist_turn_end`）。

### 0.5 TurnEnd — 轮次结束 ✅

**触发：** 每轮 LangGraph **必经**末节点 `persistTurnEnd`（`userFact` / `analyst` / `respondEarly` → `persistTurnEnd` → `END`）。**非 LLM**。

**职责：**

1. `persistPipelineMemory` — Mem0 轮次写入 + LangMem 会话摘要
2. `persistLearningAfterTurn` — Learning 候选（`userFact` 轮次跳过）
3. **跳过：** `repeatQuestionHit`、空 `answer`

**代码：** `agentflow/brain-service/online/persist-turn-end/` · SSE step 名 **`persist_turn_end`**（UI：写入记忆）

**验证：** `verify:fact-checker:pipeline` 闲聊/检索链末步应为 `persist_turn_end`；同问短路仍会经过 `persist_turn_end`（内部 no-op）。

### 1. KnowledgeIndexer — 知识入库师 ✅

**触发：** 手动 `pnpm run index:corpus`（语料 md 变更、换 embed 模型、改分块规则后重跑）。**不参与**用户聊天实时链路。

**技术：** LlamaIndex、ChromaDB、Ollama Embed、Zod（metadata）、Pino。

```mermaid
flowchart TD
  CLI["apps/brain-service/scripts/index-all-corpus.ts"] --> ALL["indexAllCorpora()"]
  ALL --> LISTU["listCorpusUserIds()"]
  LISTU --> LOOP{每个 corpusUserId}
  LOOP --> ONE["indexOneCorpusUser()"]
  ONE --> SCAN["listMarkdownFiles(corpus/)"]
  SCAN --> READ["readFile 每篇 md"]
  READ --> SPLIT["splitMarkdownToDocuments()"]
  SPLIT --> META["chunkMetadataSchema 校验"]
  META --> EMBED["addDocumentsWithEmbedLimit<br/>p-limit 分批 embed"]
  EMBED --> CHROMA[("Chroma collection<br/>全量 delete + 重建")]
```

| 步骤 | 做什么 | 规则 | 文件 | 方法 |
|------|--------|------|------|------|
| 0 | CLI 入口 | 加载 `.env`；失败 exit 1 | `apps/brain-service/scripts/index-all-corpus.ts` | — |
| 1 | 找用户 | `data/doc/users/*` 下 corpus 至少有 1 个 `.md` | `list-corpus-users.ts` | `listCorpusUserIds()` |
| 2 | 路径约定 | 语料根 `users/<id>/corpus/` | `apps/brain-service/src/knowledge/doc-paths.ts` | `getUserCorpusRoot()` |
| 3 | 扫 md | 递归 `.md`；跳过 `vault/originals/images/...` | `list-markdown-files.ts` | `listMarkdownFiles()`, `toRepoPath()` |
| 4 | 读正文 | UTF-8 读全文 | `index-one-user.ts` | `readFile()` |
| 5 | 分块 | 按 `##` 切；无 `##` 整篇 1 块；`id_`=user:path:index | `split-markdown.ts` | `splitMarkdownToDocuments()` |
| 6 | metadata | path / title / chunkIndex / corpusUserId | `chunk-metadata.ts` | `chunkMetadataSchema.parse()` |
| 7 | embed | `OLLAMA_MODEL_EMBED`（默认 nomic-embed-text）；**p-limit** 限制并发批次数 | `embed-batches.ts`, `index-one-user.ts` | `addDocumentsWithEmbedLimit()`, `getEmbedIndexOptions()` |
| 8 | 存 Chroma | collection=`fambrain_corpus_<userId>`；**先删后建**（全量幂等） | `index-one-user.ts`, `constants.ts` | `ChromaVectorStore`, `getChromaServerUrl()` |
| 9 | 日志 | JSON 结构化 | `index.ts` | `indexerLogger`（pino） |

**前置：** 终端 1 `pnpm run chroma:server`；Ollama 可访问且已 pull embed 模型。

### 2. IntakeCoordinator — 入口接线员 ✅

**职责：** 只产 **路由 JSON**，不写终稿、不检索。

**技术：** LangChain `ChatOllama`、`SystemMessage` / `HumanMessage`；输出 **Zod**（`intakeRoutingSchema`）。

```mermaid
flowchart TD
  H[DbChatTurn 历史] --> LLM["ChatOllama.invoke<br/>SystemMessage + 历史"]
  LLM --> RAW[原始 JSON 字符串]
  RAW --> PARSE["parseIntakeDecision()"]
  PARSE -->|失败| DEF["defaultIntakeDecision()"]
  PARSE --> OK[IntakeRoutingDecision]
  DEF --> OK
  OK --> PIPE["LangGraph compile.ts"]
```

| 步骤 | 做什么 | 规则 | 文件 | 方法 |
|------|--------|------|------|------|
| 1 | 拼 prompt | 系统指令定义 intent / searchQuery 等 | `IntakeCoordinator/prompt.ts` | `prompt` |
| 2 | 调模型 | 一次 `invoke`；模型见 `OLLAMA_MODEL_INTAKE_COORDINATOR` | `IntakeCoordinator/ollama-chat.ts` | `completeIntakeCoordinator()` |
| 3 | 解析 JSON | 抠 JSON → **Zod parse**；`userFact*` 缺省视为 `null`（勿误 fallback 检索） | `intake-coordinator/pipeline/parse-intake.ts`, `schema.ts` | `parseIntakeDecision()`, `intakeRoutingSchema` |
| 4 | 兜底 | 解析失败 → `| 5 | 编排 | LangGraph 条件边 | `pipeline/graph/routes.ts` + `compile.ts` | `routeAfterIntake()` 等 |

**Guard 链（compile intake 节点内）：** **列举续问短路**（「更多项目 / 列出全部」→ `resolveEnumerationContinuation()`，跳过 LLM）→ LLM 路由 → **LLM 指代/澄清** → chitchat → **retrievalPlan guard** → **`routeUserFactFromIntake`**（P0-16）→ **`applyCompositeRouteGuard`**（P0-15）→ **`applyEnumerationListIntentGuard`**（单问穷举 → `listIntent=exhaustive`）。详见 [坑点 §2.5.6](./04-pitfalls.md#256-综合问项目段只列-2-个-p0-22--2026-07)。

### 2.5 跨会话用户事实 userFact — P0-16 ✅

**职责：** 用户自述联系方式/账号（QQ、手机、邮箱、微信等）的 **记住** 与 **跨 conversationId 召回**；不经 KM / FactChecker / Analyst，直接读写 Mem0。

**设计要点：**

| 层 | 模块 | 行为 |
|----|------|------|
| **Intake schema** | `prompt.ts` + `schema.ts` | `intent`: `remember_user_fact` / `recall_user_fact`；字段 `userFactKey` / `userFactLabel` / `userFactValue` |
| **路由** | [`user-fact/user-fact.ts`](../apps/brain-service/src/agentflow/brain-service/online/user-fact/user-fact.ts) | `isUserFactIntent` + `routeUserFactFromIntake()`；**不靠问句 regex 词表** |
| **编排** | `routes.ts` | Intake 后 `remember_user_fact` / `recall_user_fact` → **userFact 节点** → persistTurnEnd |
| **Mem0** | `mem0/store.ts` | `addStructuredUserFact()` 写入；`searchUserFactMemories(factKey, label, question)` 语义检索 |
| **值提取** | `user-fact.ts` | `extractByFactKey` + `validateFactValueForKey`；Mem0 行如 `QQ号是734858469` 须提取完整号码（勿误切「码」） |

```mermaid
flowchart TD
  U[用户: 我的qq是734858469] --> IC[IntakeCoordinator]
  IC -->|remember_user_fact| UF[userFactNode]
  UF --> M0[addStructuredUserFact]
  M0 --> A1[确认已记住]

  U2[新对话: 我的qq是多少] --> IC2[IntakeCoordinator]
  IC2 -->|recall_user_fact| UF2[userFactNode]
  UF2 --> S[searchUserFactMemories]
  S --> A2[您记录的QQ号是 …]
```

| 步骤 | 做什么 | 文件 | 方法 |
|------|--------|------|------|
| 1 | Intake 产出 schema | `intake-coordinator/prompt.ts` | `remember_user_fact` / `recall_user_fact` 示例 |
| 2 | 解析路由 | `user-fact.ts` | `routeUserFactFromIntake()`、`findUserFactValueInTexts()` |
| 3 | 写入 / 召回 | `user-fact/nodes/user-fact-node.ts` | `userFactNode()` → Mem0 |
| 4 | SSE | `stream.ts` | step `user_fact` |

**验证：** `pnpm --filter @fambrain/brain-service run verify:user-fact`（跨 conversationId A 记 → B 问）。**改 agents 代码后须重启服务**；与 Pipeline cache 无关。

### 3. KnowledgeManager — 知识管理员 ✅

**职责：** 产出 `hits[]`（path / excerpt / relevance），不对用户说话。

**技术：** **纯规则精排**（无 LLM）。**Hybrid 并行召回**（Chroma 向量 ∥ corpus BM25）→ RRF 融合 → `tokenize` + `pickExcerpt` 确定性输出。与业界「检索层不用 Chat LLM、生成留给 Analyst」一致；避免小模型在精排阶段改写 excerpt、编造 `notes`（见 [坑点 P0-4 / D3-3](./04-pitfalls.md)）。

> **v3 设计：** Hybrid（向量 + BM25）+ RRF 已接入；Intake `queryType`、confidenceTier、列举分流见 [km-retrieval-design.md](./km-retrieval-design.md)。

```mermaid
flowchart TD
  IN["searchQuery + queryType + topics + subTasks"] --> PROFILE["resolveQueryProfile"]
  PROFILE --> HY["hybridRecall: vector ∥ BM25 sparse"]
  HY --> RRF["fuseRrf + merge by path"]
  RRF --> RAW[candidates + recallChannel]
  RAW --> IDINJ["identity: 补注入 personal 简历"]
  IDINJ --> ENUMINJ{"enumeration target?"}
  ENUMINJ -->|experience| EXINJ["注入 experience/ 全量 + fill"]
  ENUMINJ -->|project| PRINJ["注入 projects/ 全量 + fill"]
  EXINJ --> CAND[candidates 就绪]
  PRINJ --> CAND
  CAND --> RULE["rankCandidates: token+vector/sparse+pathBoost"]
  RULE --> GUARD["identityGuard / enumerationFill"]
  GUARD --> TIER["assessConfidence → confidenceTier"]
  TIER --> COV["deriveCoverageFromTier + tierNotes"]
  COV --> OUT["hits / coverage / notes (+ confidenceTier?)"]
```

| 步骤 | 做什么 | 规则 | 文件 | 方法 |
|------|--------|------|------|------|
| 1 | Hybrid 召回 | 向量 + BM25 **并行**；RRF 融合；topK 按 profile | `hybrid-recall.ts`、`fusion-rrf.ts` | `hybridRecall()` |
| 2 | 关键词扫盘 | ~~向量空或低置信时扫三目录~~ **已移除**（由 BM25 sparse 替代） | — | — |
| 3 | 规则精排 | **token + vector + pathBoost**；`pickExcerpt`（表格行优先） | `retrieve-helpers.ts` | `rankCandidates()`、`pickTableExcerpt()` |
| 4 | identity / 列举保底 | identity 补注入 personal + Top1；**enumeration 按 target**：`experience` → experience fill；`project` → projects fill（`resolveEnumerationTarget`） | `retrieve.ts`、`enumeration-target.ts`、`retrieve-helpers.ts` | `ensureIdentityPersonalCandidate()`、`ensureEnumerationExperienceCandidates()`、`ensureEnumerationProjectCandidates()`、`applyEnumerationFill(..., target)` |
| 5 | 兜底 | **低置信**才 `ensureNonEmptyHits`；高/中置信不硬塞 Top1 | `retrieve.ts`、`score-candidate.ts` | `shouldCoalesceEmptyHits()`、`ensureNonEmptyHits()` |
| 6 | 置信分档 | 融合分 + gap + path 权威 → `high` / `mid` / `low` | `score-candidate.ts` | `assessConfidence()`、`deriveCoverageFromTier()` |
| 7 | 输出 | **maxHits 按 profile**；列举型 notes 标明覆盖段数；可选 `confidenceTier` | `types.ts` | `KnowledgeRetrievalResult` |

### 4. FactChecker — 事实核查员（D5）✅

**职责：** 审查当轮 `hits` / `coverage` 是否足以回答 `userQuestion`；**不写终稿**。`passed=false` 时产出 `refinedSearchQuery`，编排器最多再打回 KM **1 次**。

**技术：** LangChain `ChatOllama`；`confidenceTier=high` 时规则快检跳过 LLM（`tier_skip_llm`）；规则兜底 `buildRuleBasedFactCheck()`；输出 **Zod**（`factCheckerResultSchema`）；`retryCount≥1` 时代码强制放行。

```mermaid
flowchart TD
  IN["userQuestion + hits + coverage<br/>searchQuery + retryCount"] --> LLM["completeFactCheck()"]
  LLM --> NORM["normalizeFactCheckerResult()"]
  NORM -->|passed=false, retry=0| REWRITE["更新 decision.searchQuery"]
  NORM -->|passed=true 或 retry≥1| NOTES["合并 checkerNotes → notes"]
  REWRITE --> RET["retrieval 节点再打回"]
  NOTES --> CO["ContentOrganizer"]
  CO --> IA["InformationAnalyst"]
```

| 步骤 | 做什么 | 规则 | 文件 | 方法 |
|------|--------|------|------|------|
| 1 | 输入 | 含 `retryCount`（0=首次，1=已重试） | `fact-checker/prompt.ts` | `FactCheckerInput` |
| 2 | 调模型 | 与 Intake 同 `OLLAMA_MODEL_INTAKE_COORDINATOR` | `check-facts.ts` | `completeFactCheck()` |
| 3 | 解析 | JSON → **Zod** → `passed` / `evidenceScore` / `issues` | `check-helpers.ts`, `schema.ts` | `normalizeFactCheckerResult()` |
| 4 | 兜底 | LLM 失败走规则；重试后强制 `passed=true` | `check-helpers.ts` | `buildRuleBasedFactCheck()` |
| 5 | 编排 | `checkerPassed` → contentOrganizer 或 retrieval | `pipeline/graph/routes.ts`、`fact-checker/fact-checker-node.ts` | `runFactCheckerNode()`, `routeAfterFactChecker()` |

**验证：** `pnpm run verify:fact-checker`（规则）、`pnpm run verify:fact-checker:pipeline`（轻量冒烟）、`pnpm run golden:regression`（G1～G5 标准回归）。同句再问走 **同问短路** 或 **检索结果 cache**，见 [坑点 §2.2](./04-pitfalls.md)。

### 5. InformationAnalyst — 信息分析师 ✅

**职责：** 据整理后的 `hits` 写终稿；无证据时 `insufficientEvidence`，禁止编造履历。

**P0-12（2026-06-18）：** `hits.length===0` 或 `coverage==="none"` 时 **`shouldSkipAnalystLlm`** 不调 Ollama，直出 `buildFallbackAnswer`（日志 `rules_empty_hits_skip_llm`）。年龄/姓名单问空 hits 有字段化文案（2026-06）。**P0-18（2026-06）：** slot + 槽答案缓存命中时不再误走空 hits 兜底，见 [坑点 §2.5.4](./04-pitfalls.md#254-单问年龄--多轮-cache-p0-18--2026-06)。

**P0-15 composite（2026-06）：** `routeMode=composite` 且 ≥2 槽 → **`stream-composite.ts`** 顺序分问 token 流式；槽答案缓存 命中 instant 回放；新 facet 写回 `composite-answer-cache`。composite ≥2 槽跳过 FactChecker LLM。

**P0-19 / P0-20（2026-06）：** 单问 `identity` / `enumeration` / `default` 走 **plain-text 流式**（与 composite 子问同路径，`think: false`），避免 JSON 解析失败退回「根据知识库摘录」体；hits 上限与 KM **queryProfile** 对齐（`analyst-recall-limits.ts`）；ContentOrganizer 按 profile 设 `maxHits`。详见 [坑点 §2.5.5](./04-pitfalls.md#255-analyst-纯文本流--enumeration-项目公司分流-p0-19--p0-20--p0-21--2026-06)。

**P0-24（2026-07）：** 四类数据源架构 — Intake `applyToolPlanGuard` 富化 `enrichedPlan` / `executionPlan`；**`toolOrchestrator`** 节点在 CO 之后执行 `compute_age_from_hits` / `compose_enumeration` / `search_web`；混合评估走 **`dagExecutor`**。年龄从 Analyst 内联上移到编排层；`prepareTurnStart` 注入 `asOfDate`。详见 [架构 v2](./05-architecture-v2-tool-orchestration.md)。

**P0-23（2026-07，已被 P0-24 吸收）：** composite / 单问 **identity 年龄槽** → `compute_age_from_hits`；原 `resolveOrchestratedTool` 在 Analyst 内，现优先走 `state.toolResults`。详见 [坑点 §2.5.7](./04-pitfalls.md#257-identity-年龄编排工具-p0-23--2026-07)。

**技术：** composite / 单问列举 / **identity 年龄** → **编排工具或 plain-text 流式**；`tech` 单问仍 JSON **Zod**；fallback 为紧凑列表（非 raw excerpt 粘贴）。

```mermaid
flowchart TD
  IN["userQuestion + hits + toolResults + queryType"] --> MODE{"analyzeMode"}
  MODE -->|composite ≥2 槽| COMP["streamCompositeAnalyze()<br/>读 toolResults[slot_*]"]
  MODE -->|single plain| PLAIN["streamAnalyzeSubQuestion()"]
  MODE -->|routeMode=dag| DAGIN["notes 含 synthesis 材料"]
  DAGIN --> PLAIN
  MODE -->|single tech| JSON["streamSingleAnalyze JSON + Zod"]
  COMP --> PICK{"pickToolResultForSubQuestion"}
  PLAIN --> PICK
  PICK -->|命中| TOOL["toolRunToAnalystResult<br/>跳过 LLM"]
  PICK -->|null| LLM["streamAnalyzeSubQuestion LLM"]
  TOOL --> ANS[answer + citations]
  LLM --> MERGE["mergeSubQuestionAnswers()"]
  JSON -->|parse 失败| FB["buildFallbackAnswer"]
  JSON --> ANS
  MERGE --> ANS
  FB --> ANS
```

| 步骤 | 做什么 | 规则 | 文件 | 方法 |
|------|--------|------|------|------|
| 1 | 输入 | hits + **queryType** / **topics**（来自 Intake） | `InformationAnalyst/prompt.ts` | `InformationAnalystInput` |
| 2 | 空 hits 短路 | **P0-12** 不调 LLM | `analyze-helpers.ts` | `shouldSkipAnalystLlm()` |
| 3 | profile 上限 | enumeration **8** / identity **4**（非固定 4） | `analyst-recall-limits.ts` | `maxAnalystHitsForProfile()` |
| 4 | 流式 | composite + 单问列举 → **rules Composer**（不调 LLM）+ `ui_block`；tech → JSON | `compose-message.ts`, `stream-composite.ts` | `composeEnumerationAnswer()`, SSE `ui_block` |
| 5 | 子问 prompt | identity/tech 仍 LLM；**enumeration 不走 LLM** | `analyze-helpers.ts` | `shouldSkipSubQuestionLlm()` |
| 6 | fallback / blocks | **序号 + 项目名**（无 excerpt）；`enumeration` 表格块 + `paginationHint` | `enumeration-format.ts`, `compose-message.ts` | `formatHitsAsAnswerList()`, `buildEnumerationBlock()` |
| 7 | 落库 | `Message.content` = plainText；`metadata.blocks` | `handle-post-message.ts` | `appendAssistantMessage(..., { blocks })` |
| 8 | Web UI | `#` + 项目名称表格；分页说明；续问按钮 **自动发送** | `assistant-message-content.tsx`, `chat-shell.tsx` | `EnumerationBlockView`, `sendMessageWithContent()` |

### 6. ContentOrganizer — 内容整理师（D6）✅

**职责：** 在 FactChecker 放行后、Analyst 生成前，对 `hits` 做 **Zod 规范化**、**同 path 去重**、excerpt 合并；空 hits 时将 `coverage` 降为 `none`。**不调 LLM**。

**技术：** Zod（`knowledgeHitsSchema`）；规则合并（`organizeHits` / `dedupeCitations`）；**maxHits 随 queryProfile**（enumeration **8**，default **5**）。

```mermaid
flowchart TD
  IN["hits + coverage + queryProfile?"] --> ZOD["parseKnowledgeHits()"]
  ZOD --> DEDUP["organizeHits()<br/>path 去重 + excerpt 合并"]
  DEDUP --> COV{coverage 调整}
  COV -->|hits 为空| NONE[coverage = none]
  COV -->|有 hits| KEEP[保留 coverage]
  NONE --> OUT[整理后 hits / coverage / notes]
  KEEP --> OUT
```

| 步骤 | 做什么 | 规则 | 文件 | 方法 |
|------|--------|------|------|------|
| 1 | 输入 | 上游 KM + FactChecker 的 `hits` / `coverage` / `notes` | `content-organizer/prompt.ts` | `ContentOrganizerInput` |
| 2 | Zod 校验 | 丢弃非法 hit 字段 | `content-organizer/schema.ts` | `parseKnowledgeHits()` |
| 3 | path 去重 | 同 path 保留最高 relevance；excerpt 合并（≤320 字） | `organize-hits.ts` | `organizeHits()`, `normalizeDocPath()` |
| 4 | coverage | hits 为空 → `none` | `organize-knowledge.ts` | `organizeKnowledge()` |
| 5 | 编排 | FactChecker 后固定进入 | `content-organizer/content-organizer-node.ts` | `runContentOrganizerNode()` |

**验证：** `pnpm run verify:content-organizer`；全 Agent schema：`pnpm run verify:agent-schemas`。

### 7. DocParser — 文档解析师（D7）✅

**触发：**

- **Web**：`/corpus` 语料导入页（拖放 / 选文件 / 选文件夹）或对话输入框 **+** 附件；`POST /api/documents/upload` → Agents `POST /documents/upload`
- **CLI**：`pnpm run parse:documents -- <path...>`（**无需 userId**；语料归属见 `.env` `FAMBRAIN_CORPUS_USER_ID` 或 `data/doc/users/`）

**不参与**在线聊天问答实时链路（上传后可选重建 Chroma，再被 KM 检索）。

**职责：** 批量接收 PDF / Word / PPT / 图片 → 解析为 Markdown → 原件存 `vault/originals/uploads` → **按文件自动分类**写入 `corpus/<personal|projects|experience>/imports/` → 可选 `indexOneCorpusUser()`。用户只见摘要：「已导入 N 个文件：个人 X · 项目 Y · 经历 Z，向量库已更新」。

**分类：** `resolveCorpusCategory()` — 路径含 `personal/projects/experience` 优先；否则按文件名 / 标题 / 正文关键词推断；默认 `personal`。CLI `--category` 可整批强制覆盖。

**技术：** pdf-parse、officeparser、mammoth（docx）、Ollama vision OCR（图片）、p-limit 并发、Zod（结果 schema）、Pino。

```mermaid
flowchart TD
  WEB["Web /corpus 或对话 +"] --> API["POST /documents/upload"]
  CLI["pnpm run parse:documents"] --> BATCH
  API --> BATCH["ingestDocumentBatch()"]
  BATCH --> CLASS["resolveCorpusCategory() 每文件"]
  CLASS --> VAULT["saveOriginalToVault()"]
  BATCH --> PARSE["parseDocumentContent()"]
  PARSE --> MD["writeParsedToCorpus()"]
  MD --> IDX{indexAfter?}
  IDX -->|是| KI["indexOneCorpusUser()"]
  IDX -->|否| DONE[返回 categorySummary]
  KI --> DONE
```

| 步骤 | 做什么 | 规则 | 文件 | 方法 |
|------|--------|------|------|------|
| 0 | HTTP / CLI | JWT 鉴权（Web）；CLI 自动 `resolveDefaultIngestIdentity()` | `documents-upload.ts`, `parse-documents.ts` | `handleDocumentsUpload()` |
| 1 | 分类 | 每文件独立；可选 `relativePaths`（文件夹上传） | `resolve-corpus-category.ts` | `resolveCorpusCategory()` |
| 2 | 存原件 | `users/<actor>/vault/originals/uploads/` | `write-corpus-md.ts` | `saveOriginalToVault()` |
| 3 | 解析 | PDF→pdf-parse；Word→mammoth/docx+officeparser；PPT→officeparser；图片→Ollama OCR | `parse-file.ts`, `parse-image-ocr.ts` | `parseDocumentContent()` |
| 4 | 写 md | `corpus/<category>/imports/` | `write-corpus-md.ts` | `writeParsedToCorpus()` |
| 5 | 入库 | 默认 `indexAfter=true`；Web 大批量客户端分批，末批才 index | `ingest-batch.ts` | `ingestDocumentBatch()` |
| 6 | 并发 | `DOC_PARSE_CONCURRENCY`（默认 2） | `ingest-batch.ts` | `getDocParseConcurrency()` |

**验证：** `pnpm run verify:doc-parser`（格式 / 路径 / 分类单测，不依赖 Ollama）。

### 8. 记忆层 — Mem0 + LangMem（D8）✅

**触发：** 每轮 LangGraph **`prepareTurnStart` 节点**内调用 `preparePipelineMemory()`（`agentflow/brain-service/online/prepare-turn-start/prepare-turn-start.ts`）。**不参与**离线入库链路。

**职责：** **Mem0** 按 `actorUserId` 检索跨会话偏好/事实；**LangMem** 按 `conversationId` 维护会话摘要；合并为 `memoryBlock` 注入 **IntakeCoordinator** 与 **InformationAnalyst** prompt。轮次结束后由 **`persistTurnEnd` 节点**写回 Mem0 与 LangMem。

**P0-16 补充：** 联系方式类 **remember/recall** 走 **userFact 节点**（`addStructuredUserFact` / `searchUserFactMemories`），不依赖轮次后 LLM 抽取；LangMem 仍仅本会话。

**存储：** `data/memory/mem0/history.db`（Mem0 SQLite）、`data/memory/sessions/<conversationId>.json`（LangMem）。BFF 请求体须带 `conversationId`（`packages/brain-types`）。

```mermaid
flowchart LR
  Q[用户问题] --> PT[prepareTurnStart 节点]
  PT --> PREP["preparePipelineMemory()"]
  PREP --> M0["searchUserMemories()<br/>Mem0"]
  PREP --> LM["loadSessionSummary()<br/>LangMem"]
  M0 --> BL["buildMemoryPromptBlock()"]
  LM --> BL
  BL --> IC[IntakeCoordinator]
  BL --> IA[InformationAnalyst]
  OUT[assistant 终稿] --> PST[persistTurnEnd 节点]
  PST --> PERS["persistPipelineMemory()<br/>persistLearningAfterTurn()"]
```

| 步骤 | 做什么 | 配置 | 文件 | 方法 |
|------|--------|------|------|------|
| 0 | 开关 | `MEM0_ENABLED` / `LANGMEM_ENABLED`（默认开） | `memory/config.ts` | `getMemoryConfig()` |
| 1 | 加载 | 检索 Mem0 + 读会话摘要；裁剪 Intake 历史 | `prepare-context.ts` | `preparePipelineMemory()` |
| 2 | 注入 | `memoryBlock` 拼入 system/human | `build-prompt-block.ts` | `buildMemoryPromptBlock()` |
| 3 | 持久化 | 本轮 user/assistant 写入 Mem0；LangMem 摘要；Learning 候选 | `agents/online/persist-turn-end/`、`packages/brain-memory/persist-turn.ts` | `runPersistTurnEnd()` → `persistPipelineMemory()` |

**验证：** `pnpm run verify:memory`（需 Ollama；可 `MEM0_ENABLED=false` 仅测 LangMem）。

### 9. ContentSummarizer — 内容摘要师（D9）✅

**触发：**

1. **在线（主路径）**：Intake 判定 `intent === "summarize_content"` → 可选 KM 检索 → **ContentSummarizer** → 终稿（不经 Analyst）。
2. **CLI**：`pnpm run summarize:document -- <file.md>`（单文件工具，不经过 Intake）。

**职责：** 对检索片段或用户原文生成结构化摘要，格式化为 Markdown 回复（`title` / `summary` / `bullets` / `keywords`）。

| 步骤 | 做什么 | 文件 | 方法 |
|------|--------|------|------|
| 1 | 截断正文（≤12k 字） | `summarize.ts` | `summarizeContent()` |
| 2 | Ollama + Zod | `schema.ts`, `prompt.ts` | `parseContentSummaryResult()` |
| 3 | 读文件 | `summarize-file.ts` | `summarizeMarkdownFile()` |
| 4 | 编排 | `compile.ts` | `contentSummarizerNode()`；`buildSummarizeSourceText()` |
| 5 | 展示 | `format-answer.ts` | `formatSummaryAsAnswer()` |

**在线分支（`compile.ts`）：**

```mermaid
flowchart TD
  U[用户: 总结某项目] --> IC[IntakeCoordinator]
  IC -->|intent=summarize_content| R{  R -->|true| KM[KnowledgeManager]
  R -->|false| CS[ContentSummarizer]
  KM --> CS
  CS --> OUT[assistant 终稿]
```

**验证：** `pnpm run verify:content-summarizer`；`verify:agent-schemas`（含 `summarize_content` intent）；CLI 需 Ollama。

### 10. 实验触达 — MCP / Recall / Vercel AI ✅

与主链解耦，脚本在 `apps/brain-service/scripts/experiments/`，说明见 [experiments/README.md](../experiments/README.md)。

| 实验 | 命令 | 作用 |
|------|------|------|
| MCP 列 vault | `pnpm run experiment:mcp-vault` | stdio MCP 工具 `list_vault_files` |
| Recall 对比 | `pnpm run experiment:recall-compare -- <userId> "query"` | BM25 sparse vs `searchCorpusVectors` |
| Sparse / Hybrid 自测 | `pnpm run verify:sparse-recall` / `verify:hybrid-recall` / `verify:recall-compare` | HY-01～07 |
| Vercel AI SDK | `pnpm run experiment:vercel-ai -- "prompt"` | `streamText` + Ollama（主链仍自研 SSE） |
| LangChain bindTools | `pnpm run experiment:bind-tools -- "问法"` | ReAct 选 StructuredTool；`--schema-only` 不测 Ollama |

**验证：** `pnpm run verify:vault-list`（vault 列举单测）。

### 11. 自主学习管道 — Learning Phase A–D ✅

**触发：** 每轮 LangGraph **`persistTurnEnd` 节点**内调用（`agents/offline/learning/persist-learning.ts`）。**`LEARNING_PIPELINE_ENABLED=false` 时跳过。**

**Phase 概览：**

| Phase | 能力 | 代码 / 数据 |
|-------|------|-------------|
| **A** HITL pending | 中置信候选写入 DB，Web `/learning` 人工审核 | `PendingMemoryFact` · `POST /api/pending-memory-facts` · Agents `POST /learning/apply` |
| **B** 高置信 Mem0 | `confidence ≥ LEARNING_AUTO_MEM0_MIN_CONFIDENCE` 自动结构化写入 Mem0 | `persist-learning.ts` · 开启 learning 时 `persist-turn-end` 跳过盲目 `addTurnToMem0` |
| **C** `corpus/learned/` | 更高置信写入 Markdown + 可选 reindex | `writeLearnedFactToCorpus` · BM25/KM 扫盘含 `learned/` · `PATH_BOOST_LEARNED` |
| **D** 检索反馈 | 聊天消息下 👍/👎 → 按 path 聚合 boost KM rerank | `RetrievalFeedback` · `aggregateFeedbackByPath` · `message-retrieval-feedback.tsx` |

```mermaid
flowchart LR
  T[Pipeline 终稿] --> EX[extractLearnedCandidates]
  EX --> R{置信度路由}
  R -->|≥ auto corpus| LC[writeLearnedFactToCorpus + reindex]
  R -->|≥ auto mem0| M[addStructuredUserFact]
  R -->|pending 区间| P[(PendingMemoryFact)]
  P -->|Web 审核 apply| LC
  P -->|Web 审核 apply| M
  FB[用户检索反馈] --> KM[KM rerank boost]
```

**验证：**

```bash
pnpm --filter @fambrain/brain-service run verify:learning-extract
# Web：/learning 审核 pending；聊天助手消息下反馈按钮
```

### 12. LangChain StructuredTool 层 ✅

**定位：** 将已有 FamBrain 能力封装为 LangChain **`tool()`**（Zod schema），供实验性 `bindTools` / 外部 Agent 复用；**主聊天仍走 LangGraph 固定节点**，不由 LLM 自主选工具。

| Tool | 包装 | 说明 |
|------|------|------|
| `retrieve_corpus` | `retrieveKnowledge` | 语料 hybrid 检索，返回 JSON hits |
| `remember_user_fact` | `addStructuredUserFact` | 结构化写入 Mem0 |
| `recall_user_fact` | `searchUserFactMemories` | 跨会话召回 user_fact |
| `list_vault_files` | `listVaultFiles` | vault 只读列举（同 MCP） |
| `summarize_text` | `summarizeContent` | 正文摘要（需 Ollama） |

调用前须 `runWithToolContext({ corpusUserId, actorUserId }, () => tool.invoke(...))` 注入上下文。

**LangSmith：** `bootstrapBrainServiceRuntime()` → `configureLangSmithTracing()`；`graph.stream` 附带 `runName` / `metadata`（conversationId 等）。配 `LANGSMITH_API_KEY` 后在 [smith.langchain.com](https://smith.langchain.com) 查看 trace。

**验证：**

```bash
pnpm --filter @fambrain/brain-service run verify:langchain-tools
pnpm --filter @fambrain/brain-service run verify:vault-list   # vault 底层 API
pnpm --filter @fambrain/brain-service run experiment:bind-tools -- --schema-only
pnpm --filter @fambrain/brain-service run experiment:bind-tools -- "我的名字是什么？"
```

**bindTools 实验（`scripts/experiments/bind-tools-react.ts`）：** 将 4 个工具（不含 `summarize_text`）绑定到 `ChatOllama`，最多 4 轮 tool call → 终稿；与 Golden/eval **完全隔离**。生产聊天仍走 LangGraph 节点。

## 路由字段（IntakeCoordinator 输出）

| 英文字段 | 中文名 | 含义 | 典型去向 |
|----------|--------|------|----------|
| `intent` | 意图类型 | 查库回答 / 直接答 / 澄清 / 闲聊 / 拒答 | 编排器分支 |
| `| `searchQuery` | 检索查询句 | 去掉寒暄后的检索关键词句 | → KnowledgeManager 入参 |
| `subTasks` | 子任务列表 | 复杂问题拆成多句 | → KM / Analyst |
| `topics` | 主题标签 | 如 `resume`、`aky` | → KnowledgeManager 入参 |
| `language` | 回复语言 | `zh` / `en` / `mixed` | → InformationAnalyst 入参 |
| `confidence` | 置信度 | 0–1，可观测、可降级 | 日志 / 后续策略 |
| `clarifyingQuestion` | 澄清提问 | 信息不足时追问一个关键问题 | **直接返回用户** |
| `briefReply` | 简短回复 | 寒暄或拒答（≤80 字） | **直接返回用户** |
| `userFactKey` | 事实键 | 如 `qq` / `phone` / `email` / `wechat` | → **userFact 节点** |
| `userFactLabel` | 展示标签 | 如「QQ号」 | → userFact 召回文案 |
| `userFactValue` | 事实值 | remember 时必填；recall 时为 `null` | → Mem0 写入 / 校验 |

## 编排分支（`pipeline/graph/routes.ts` + `compile.ts`）

| 条件 | 节点顺序 | 用户看到什么 |
|------|----------|--------------|
| `intent === "clarify"` 且 `clarifyingQuestion` 有值 | `respondEarly` | 澄清提问 |
| `intent` 为 `chitchat` / `out_of_scope` 且 `briefReply` 有值 | `respondEarly` | 简短回复 |
| `intent === "summarize_content"` 且 `| `intent === "summarize_content"` 且 `| `intent` 为 `remember_user_fact` / `recall_user_fact` 且 Intake 填齐 schema | **userFact** → 终稿 | SSE：`user_fact`；**不经 KM / FC / Analyst** |
| `| `| FactChecker `passed=false` 且 `retryCount<1` | 再 `retrieval` → 再 **FactChecker** | 同轮可能见两次「核查证据…」 |
| 其余 | `respondEarly` | 简短说明或请用户补充 |

## 流式 SSE 事件（`POST .../messages`）

| `event` | 含义 |
|---------|------|
| `meta` | 用户消息已落库（含真实 `id`） |
| `step` | 编排进度：**`prepare_turn_start`** / `intake` / **`user_fact`** / `retrieval` / `fact_checker` / **`content_summarizer`** / **`content_organizer`** / `analyst` / **`persist_turn_end`**，`status` 为 `running` \| `done`；`done` 时可带 `durationMs` |
| `pipeline_timing` | SLO：本轮 `totalMs`、`ttftMs`、各节点 `nodes`（Agents → BFF 转发） |
| `ready` | Pipeline 已出终稿、即将落库（BFF）；前端可提前解锁输入 |
| `thinking` | 信息分析师推理流（若模型/Ollama 支持） |
| `assistant` | 面向用户的正文增量（流结束后以 `answer` 写入 DB） |
| `done` | 流结束，含 user/assistant 消息 id、终稿 `content`、可选 `timing` |
| `error` | 模型或编排失败 |
