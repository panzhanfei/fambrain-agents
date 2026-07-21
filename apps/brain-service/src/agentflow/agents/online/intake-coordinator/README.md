# IntakeCoordinator（入口接线员）

Intake 是 Pipeline 的**第一个 LLM 在线 Agent**（图内位于 **`prepareTurnStart` 之后**）。它把用户自然语言变成一张**结构化路由工单**，告诉下游「要不要查库、查什么、单问还是多问分槽、还是直接短答 / 记 QQ」。

**Intake 不做的事：** 检索语料、事实核查、写最终长分析、读写数据库、同问短路、Mem0/LangMem 加载（见 `../prepare-turn-start/`）。

---

## 1. 设计思路

### 1.1 为什么单独做一个 Agent？

| 问题 | Intake 的解法 |
|------|---------------|
| 下游 KM / FC / Analyst 各自猜意图会冲突 | **单一决策点**：只在这里定 intent + searchQuery |
| 纯 LLM 不稳定（闲聊乱称呼、指代误判） | **LLM 理解 + 轻量 guard**（指代/多槽语义终稿归 LLM；闲聊/schema 合法化/canonicalize） |
| 多问并列难检索 | **pathPlan + answerOrder → 派生 compositeSlots**，按序独立 KM/list |
| 用户口述 QQ/微信不在简历里 | **userFact 分支**，走 Mem0，不经 KM |
| 同句再问浪费算力 | **同问短路** 在 **`prepare-turn-start`** 节点（Intake 不再重复检） |
| 短续问/单字噪声 | **intake-node**：normalize 后再判单字早短路；**三信号**指代拼接最多 **1** 次；散文只做 JSON 格式修复 |

### 1.2 核心原则（端到端 PathPlan）

1. **主路径 = 执行终稿** — LLM 产出 `intent` + **`pathPlan` 四桶** + **`answerOrder`** + `composeMode` / `searchQuery` / `coreference`；下游只信结构化字段。
2. **旁路 = 合法化 + 派生** — normalize / 单字短路 / JSON 格式修复 / 指代拼接≤1（**三信号**）/ toolId 白名单 / list 页码；按 `answerOrder` **派生** `compositeSlots`（及兼容用 `retrievalPlan`）。**禁止**口语二次拆槽或 `queryType` 猜桶。
3. **宁可多检索，不要漏检索** — 简历/经历类问题默认 `retrieve_and_answer`；空 pathPlan → clarify。
4. **结构化输出** — 只产 JSON；散文反问不算合法工单（可格式修复一轮）。
5. **对外只暴露 `index.ts`** — 子目录是内部实现，外部 import 统一走 barrel。

复盘顺序：**先看 LLM 工单（pathPlan+answerOrder）→ 再看哪一层旁路改过字段**（见仓库 [`docs/04-pitfalls.md` §2.10](../../../../../../../docs/04-pitfalls.md#210-intake-档-b主路径规划--旁路纠偏-p0-31--2026-07)）。

### 1.3 技术栈

| 技术 | 文件 | 用途 |
|------|------|------|
| LangChain `ChatOllama` | `llm/ollama-chat.ts` | 调本地 Ollama（模型名见 `getBrainServiceConfig().ollama.models.intakeCoordinator`） |
| Zod | `contract/schema.ts` | 校验 / 规范化 LLM 输出的 JSON |
| 正则 + 纯函数 guard | `guards/*` | 闲聊、plan **normalize/dedupe/canonicalize**（不发明槽）、userFact 短路 |
| Mem0 / LangMem | 由 **`prepareTurnStart`** 注入 `memoryBlock` | 帮理解多轮指代，**不能**替代 searchQuery 里的实体词 |

---

## 2. 目录地图（点进来先看这个）

```text
intake-coordinator/
├── README.md              ← 本文件
├── index.ts               ← 对外 API（外部只 import 这里）
│
├── contract/              ← 数据合同
│   ├── prompt.ts          # IntakeRoutingDecision 类型 + 系统 Prompt（业务规格书）
│   └── schema.ts          # Zod 校验 LLM JSON（含 snake_case 兼容）
│
├── llm/                   ← 调模型
│   └── ollama-chat.ts     # completeIntakeCoordinator()
│
├── pipeline/              ← guard 链编排 + parse + 分步日志
│   ├── intake-pipeline.ts # runIntakePipeline()
│   └── parse-intake.ts    # parseIntakeDecision(), defaultIntakeDecision()
│
├── signals/               ← 问句结构工具 + 指代重试判定 / 单字短路
├── enumeration/           ← UI 列举按钮 prompt（exact-match）
│
├── nodes/                 ← LangGraph 图节点（仅 intake）
│   └── intake-node.ts     # 短路 → LLM →（JSON 修复）→（指代拼接≤1）→ pipeline
│
├── path-plan/             ← PathPlan 合法化 + 派生 slots（主路径）
│   ├── from-llm.ts        # legalizePathPlan / deriveCompositeSlotsFromPathPlan
│   ├── interface.ts
│   └── compile-path-plan.ts  # 旧分桶编译（测试 / 兼容；主 pipeline 不再走）
│
├── guards/                ← LLM 之后的规则兜底（不口语二次规划）
│   ├── intake-continuation-guard.ts  # 恒 noop（指代靠 intake-node merge）
│   ├── intake-link-lookup-guard.ts   # 字段自相矛盾 harmonize
│   ├── intake-chitchat-guard.ts
│   ├── intake-retrieval-plan-guard.ts  # 旧 retrievalPlan 合法化（兼容 / 非主路径）
│   ├── composite-route-guard.ts        # 旧 plan→slots（兼容 / 非主路径）
│   └── enumeration-list-intent.ts      # UI exact-match → 直接造 pathPlan.list
│
├── composite/             ← 槽类型 / 模板 / 诊断（执行仍读派生 compositeSlots）
│   ├── composite-routing.ts
│   ├── composite-slot-queries.ts
│   ├── identity-field-search.ts   # displayLabel + searchQuery（无口语 labels）
│   ├── repair-retrieval-plan.ts   # normalize + dedupeByFacet
│   └── enumeration-target.ts
```

单元测试集中在仓库 `apps/brain-service/tests/intake-coordinator/`（见该目录 README）。


用户自述记忆见同级目录 [`../user-fact/`](../user-fact/README.md)。

### 推荐阅读顺序
2. `contract/prompt.ts` — 字段含义 + Prompt 规则（pathPlan + answerOrder）
3. `path-plan/from-llm.ts` — 合法化与派生 slots
4. `pipeline/intake-pipeline.ts` — 主路径编排
5. `llm/ollama-chat.ts` — LLM 输入输出
6. [`../user-fact/`](../user-fact/README.md) — remember/recall Mem0

---

## 3. 文件流转路径（从用户消息到 decision）

### 3.1 总览

```text
Web 用户消息
    │
    ▼
pipeline/runtime/stream.ts          ← SSE 壳（消费 LangGraph stream）
    │
    ▼
pipeline/graph/compile.ts  →  runPrepareTurnStart()     ../prepare-turn-start/
    ├─ ALS enterWith + 同问短路 findRepeatAnswerInHistory
    ├─ preparePipelineMemory()  → memoryBlock, intakeHistory, userMemories
    │         同问命中 → respondEarly → END
    │
    ▼
intake-coordinator/nodes/intake-node.ts   runIntakeNode()
    │
    ├─ completeIntakeCoordinator()          llm/ollama-chat.ts  ← 原文第 1 次
    │       输入: intakeHistory + memoryBlock + contract/prompt
    │       输出: 原始 JSON 字符串
    │
    ├─ peek parseIntakeDecision → shouldRetryCoreferenceMerge
    │       coreference=unresolved（或短 clarify）且有上轮实质问
    │       → 改写最后一条 user 为「上轮；本轮」+ 系统注 + **再调 LLM 1 次**
    │
    ├─ runIntakePipeline()                  pipeline/intake-pipeline.ts
    │       parse → guard 链 → RoutedIntakeDecision
    │
    ▼
state.decision 写入 PipelineGraphState
    │
    ▼
routeAfterIntake()                        pipeline/graph/routes.ts
    ├─ userFact        → user-fact-node.ts → persistTurnEnd
    ├─ respondEarly    → respond-early-node.ts → persistTurnEnd
    ├─ retrieval       → knowledge-manager/nodes/retrieval-node → … → analyst → persistTurnEnd
    ├─ contentSummarizer
    └─ factChecker     → （无检索的 direct_answer 等）
```

### 3.2 guard 链内部顺序（`runIntakePipeline`）

```text
LLM 原始 JSON
    │
    ▼ parseIntakeDecision() / defaultIntakeDecision(clarify)
    │
    ▼ applyIntakeContinuationGuard()     恒 noop
    │
    ▼ clarify / chitchat / userFact 早退
    │   无效 recall：有 pathPlan→retrieve；空→clarify
    │
    ▼ applyIntakeLinkLookupGuard()       harmonize only（不发明拆槽）
    │
    ▼ legalizePathPlan + answerOrder + composeMode
    │   retrieve 且四桶空 → clarify
    │
    ▼ fillListPagesInPathPlan(session)   list 步补页码
    │
    ▼ deriveCompositeSlotsFromPathPlan(answerOrder)
    │   顺带派生 retrievalPlan（日志/cache）；hybrid dag → executionPlan
    │
    ▼ RoutedIntakeDecision → state.decision
```

> 纯社交短路在 **`intake-node`**。凡 `retrieve_and_answer` 须 LLM 写齐 **`pathPlan`（≥1 步）+ `answerOrder`**。旧 `retrievalPlan→compile 分桶` 主路径已删。

**列举分页：** Intake LLM 在 **`pathPlan.list`** 填 `enumerationControl`；代码只补 session 页码。UI exact-match → `buildEnumerationListDecision` 直接造 list 步。

详见坑点 [§2.5.9 GitHub 对外链接](../../../../../../../docs/04-pitfalls.md#259-简历-github--对外链接问法-p0-25--2026-07)（P0-25）。

### 3.4 单问 / 多问统一（`routeMode=slots` · PathPlan 派生）

凡需 KM/list 检索 → **`routeMode=slots`**（或 hybrid → `dag`），`compositeSlots` **按 `answerOrder` 派生**（1～N）。**禁止**编译层按 list→km→dag 重排回答顺序。

```text
pathPlan + answerOrder
    │
    ├─ deriveCompositeSlotsFromPathPlan → slots.length ≥ 1
    │       → routeMode=slots（或 hybrid dag）
    │
    └─ 空 pathPlan → clarify 早退
```

**为何：** 单问、多问共用派生 slots；cache / 日志看 `compositeSlots.length` 与 `answerOrder`。

### 3.5 单问 ↔ 多问结构对齐（`signals/query-signals.ts`）

LLM 的 `retrievalPlan` / `subTasks` 可能**与当前问句不一致**（尤其多轮 inherited plan）。**由 LLM 在本轮写齐 plan**；`query-signals.ts` 仅提供结构诊断，guard **不**据此收束/展开：

| 函数 | 判断什么 | 用途 |
|------|----------|------|
| `hasExplicitMultipartStructure(q)` | ≥2 编号行，或 ≥2 问号/并列 | 诊断：当前问句是否**真**多问 |
| `hasStaleMultipartFromDecision(d, q)` | plan≥2 或 subTasks≥2，但问句**无**并列结构 | 诊断：可能 **stale inherited plan**（复盘 / verify） |
| `extractNumberedPlanUnits(q)` | 从 `1.` `2.` 行提取子问 label | 诊断 / 测试辅助 |
| `decisionRequestsExternalLink(d)` | LLM 已标 `external_link` | link guard 入口，不在 guard 猜意图 |

**`applyIntakeLinkLookupGuard`（仅结构化 harmonize）：**

| 问句 / decision | LLM 输出 | guard 结果 | reason |
|------|----------|------------|--------|
| 顶层 `external_link` + plan 项误标 enumeration（topics 含 personal） | 1 项 | 改回 `external_link` | `harmonize_plan_query_types` |
| enumeration + external_link 混合 plan | ≥2 项 | **保留**多槽 | `preserve_mixed_plan` |
| 已是 external_link 但某项 searchQuery 空 | ≥1 项 | 补模板检索词 | `single_external_link` |

编号拆槽 / 过期 plan 收束：**由 LLM 写齐 plan**，代码不再发明。

⑤ `applyIntakeRetrievalPlanGuard`：schema 合法化 + facet 去重 + canonicalize（保留非空 searchQuery）。

**验证：**

```bash
pnpm --filter @fambrain/brain-service run verify:intake-link-lookup
pnpm --filter @fambrain/brain-service run verify:intake-coreference
```

### 3.3 Web 运行日志里 Intake 的标签

| label | 对应步骤 |
|-------|----------|
| `进入` | LLM 调用前：userQuestion、history 轮数 |
| `出去` | LLM 原始 JSON 预览 |
| `同问短路` | 同句再问命中 |
| `解析LLM输出` | parse 成功 / fallback |
| `LLM指代决策` | LLM 指代/澄清 intent；clarify 时标记 earlyExit |
| `guard_续问指代` | continuation：省略续问 → retrieve |
| `guard_闲聊` | chitchat 注入固定 briefReply |
| `guard_用户记忆` | remember / recall |
| `guard_对外链接` | external_link：stale multipart / 分槽 |
| `guard_检索计划` | retrievalPlan 合法化 / 去重 / canonicalize |
| `guard_复合路由` | routeMode、槽位列表 |
| `guard_列举分页` | listIntent=exhaustive 等 |
| `最终路由` | 交给下游的 decision 摘要 |

---

## 4. 数据结构

Intake 产出两层结构：**LLM 层** `IntakeRoutingDecision` → **编排层** `RoutedIntakeDecision`。

### 4.1 `IntakeRetrievalPlanItem`（多问时的单条检索计划）

定义：`contract/prompt.ts`

| 字段 | 类型 | 含义 | 谁消费 |
|------|------|------|--------|
| `label` | string | 子问题摘要，如「姓名」「项目经历」 | Analyst 分段标题；composite 槽 label |
| `searchQuery` | string | 该子问题专用检索词（含目录词如「个人简介 简历」） | KM 检索；检索 hits 缓存 key 的一部分 |
| `queryType` | identity \| enumeration \| tech \| **external_link** \| default | 该子问题的检索 profile | KM `queryProfile` |
| `topics` | string[] | 语料主题 hint，如 personal / project | KM 过滤 / 精排 |

### 4.2 `IntakeRoutingDecision`（LLM 工单 — 核心）

定义：`contract/prompt.ts`，校验：`contract/schema.ts`

| 字段 | 类型 | 含义 | 典型值 / 规则 |
|------|------|------|---------------|
| **intent** | 8 种枚举 | 主意图分类；**KM 路由由 intent 决定** | 见下表「intent 选用」 |
| **searchQuery** | string | 检索用词（去寒暄、补实体） | retrieve 必填；summarize 查库时必填，粘贴长文可空 |
| **subTasks** | string[] | 子任务标签 | 多问时与 retrievalPlan 对齐 |
| **topics** | string[] | 语料主题标签 | personal, resume, project, experience, tech-stack… |
| **language** | zh \| en \| mixed | 用户语言 | Analyst / 短答话术 |
| **confidence** | 0–1 | 模型对路由的把握 | 日志 / eval 用 |
| **queryType** | identity \| enumeration \| tech \| **external_link** \| default \| null | 检索问法类型 | 与 KM `queryProfile` 对齐；GitHub/URL 用 **external_link**（**禁止** enumeration）；不检索时为 null |
| **clarifyingQuestion** | string \| null | 澄清追问（只问一个） | 仅 intent=clarify 时填 |
| **briefReply** | string \| null | 极短直接回复（≤80 字） | chitchat / clarify；retrieve / summarize 必须为 null |
| **retrievalPlan** | IntakeRetrievalPlanItem[] | 检索执行计划 | **`retrieve_and_answer` 必填 ≥1 项**（单问 1 项，多问 N 项）；空 `[]` → composite **clarify**；chitchat/clarify/userFact 可为 `[]` |
| **userFactKey** | string \| null | 记忆字段 slug | qq / wechat / phone / email / dingtalk… |
| **userFactLabel** | string \| null | 展示名 | 「QQ号」「微信号」 |
| **userFactValue** | string \| null | remember 时的值 | recall 时为 null |
| **coreference** | none \| resolved \| unresolved | 多轮指代状态（LLM 标注） | unresolved 时服务端可拼接上轮再调 **1** 次 |

#### intent 选用速查

| intent | 何时 | KM |
|--------|------|-----|
| `retrieve_and_answer` | 问经历、项目、技术栈、简历字段 | 必进 |
| `summarize_content` | 用户要总结/概括某段经历或文档 | searchQuery 非空时先进 KM |
| `direct_answer` | 通用概念，与用户履历无关 | 不进 |
| `clarify` | 指代不明且 history 无法推断实体 | 不进 |
| `chitchat` | 问候、感谢、闲聊 | 不进 |
| `out_of_scope` | 应拒绝的请求 | 不进 |
| `remember_user_fact` | 「记住我的 QQ 是…」 | 不进 |
| `recall_user_fact` | 「我的 QQ 是多少」 | 不进 |

#### queryType 速查

| queryType | 何时 | searchQuery 示例 |
|-----------|------|------------------|
| `identity` | 姓名、年龄、学历、行业 | `个人简介 简历 姓名` |
| `enumeration` | 列举公司 / 全部项目 | `哪几家公司 工作经历` |
| `external_link` | GitHub、仓库、对外 URL（**非**项目名穷举） | `开源项目 GitHub 链接 个人简历` |
| `tech` | 技术栈、框架 | `城管平台 技术栈 React` |
| `default` | 其他单点事实 | `西安奥卡云 工作职责` |

### 4.3 `RoutedIntakeDecision`（guard 后的编排工单）

定义：`guards/composite-route-guard.ts`  
= `IntakeRoutingDecision` + 下列扩展字段

| 字段 | 类型 | 含义 |
|------|------|------|
| **routeMode** | skip \| slots \| list \| dag | 下游图路由模式 |
| **compositeSlots** | CompositeRetrievalSlot[] | 分槽列表（slots 时 length ≥ 1） |
| **routeReason** | CompositeRouteReason | 为何这样路由（可观测） |
| **routePlanSource** | CompositeRoutePlanSource | plan 来源（LLM plan / 结构兜底…） |
| **userFact** | UserFactRoute \| null | remember/recall 路由对象 |

#### routeMode 含义

| routeMode | 条件 | 下游行为 |
|-----------|------|----------|
| `skip` | chitchat / clarify / userFact 等不检索 | respondEarly / userFact |
| `slots` | 1～N 个检索槽 | KM 分槽并行 + merge（槽数看 `compositeSlots.length`） |
| `list` | 列举 continue / exhaustive | KM list API 分页 |
| `dag` | 混合工具编排 | dagExecutor |

#### routeReason 枚举

| 值 | 含义 |
|----|------|
| `skip_non_retrieve` | chitchat / userFact / clarify / 空 plan |
| `intake_retrieval_plan` | 来自 LLM 的 retrievalPlan（唯一编译来源） |

### 4.4 `CompositeRetrievalSlot`（检索槽）

定义：`composite/composite-slot-queries.ts`

| 字段 | 含义 |
|------|------|
| `id` | 槽 id：identity / projects / employers / plan-0… |
| `label` | 面向用户的槽标题 |
| `searchQuery` | 该槽 KM 检索词 |
| `queryType` | 该槽 KM profile |
| `topics` | 该槽语料主题 |
| `subTasks` | 子任务（通常空） |

预定义槽模板：`IDENTITY_SLOT`、`PROJECTS_SLOT`、`EMPLOYERS_SLOT`（见同文件）。

### 4.5 `UserFactRoute` / `UserFactRecord`（用户自述记忆）

定义：`user-fact/user-fact.ts`

**UserFactRoute**（编排用）

| 字段 | 含义 |
|------|------|
| `action` | remember \| recall |
| `factKey` | 稳定键 qq / wechat / phone… |
| `label` | 「QQ号」「微信号」 |
| `value` | remember 时的值（可选，guard 可从问句补） |

**UserFactRecord**（Mem0 持久化 JSON）

| 字段 | 含义 |
|------|------|
| `type` | 固定 `"user_fact"` |
| `factKey` | 同上 |
| `label` | 同上 |
| `value` | 存储的值 |

---

## 5. 数据变化（典型路径）

### 5.1 单问检索：「城管平台用了什么技术」

```text
输入: userQuestion = "城管平台用了什么技术"
      intakeHistory = [...最近对话...]
      memoryBlock = "..."（可选）

LLM 输出 IntakeRoutingDecision:
  intent: retrieve_and_answer
    searchQuery: "西安奥卡云 城市管理平台 技术栈 React TypeScript"
  queryType: tech
  retrievalPlan: []

guard 链: 通常 noop（无指代/非闲聊/非 userFact）

RoutedIntakeDecision:
  routeMode: slots
  compositeSlots: [ { id: plan-0, searchQuery: "...", queryType: tech } ]

→ routeAfterIntake → retrieval → KM 1 槽（retrieveCompositeIncremental）
```

### 5.2 闲聊：「你好」

```text
LLM:
  intent: chitchat
    briefReply: null   ← 不撰写，由服务端注入

guard_闲聊:
  briefReply → DEFAULT_CHITCHAT_BRIEF_REPLY（固定模板，忽略 LLM 原文）

pipeline → earlyExit → respondEarly → answer = briefReply
→ 无 retrieval / analyst
```

### 5.3 无上下文指代：「那个项目呢？」

```text
LLM（无上轮可拼）:
  intent: clarify
  coreference: unresolved
  clarifyingQuestion: "你指的是哪一段经历或哪个项目？…"
  
pipeline:
  LLM指代决策 → earlyExit=true
  → 跳过 retrievalPlan / composite

→ routeAfterIntake → respondEarly
```

### 5.4 有上下文指代（G5b · 代词）

```text
history:
  user: "城管平台用了什么技术"
  assistant: "React TypeScript UniApp…"
  user: "那个项目呢？"

路径 A（首轮即消解）:
  coreference: resolved → 不重试
  searchQuery 含「城市管理平台 …」

路径 B（首轮 clarify/unresolved）:
  拼接「城管平台用了什么技术；那个项目呢？」→ 第 2 次 Intake LLM
  → retrieve + coreference resolved（禁止再标 unresolved）

pipeline:
  earlyExit=false → retrieval → analyst
```

### 5.4b 实体替换续问（G5c · 【实体】呢）

```text
history:
  user: "我那一年入职奥卡云的？"
  assistant: "你于 2021 年 6 月入职…"
  user: "云联智慧呢"   # 或「友谊时光呢」等同形

路径 A（首轮即对）:
  coreference: resolved · default 单槽 · searchQuery 含「云联智慧 入职 年份」

路径 B（首轮误标 enumeration，或 plan 仍写奥卡云漏新实体）:
  shouldRetryCoreferenceMerge 三信号 → 拼接「上轮；本轮」再调 Intake
  → 须含新实体 + 继承属性；禁止 enumeration 整表

pipeline:
  earlyExit=false → retrieval → analyst → 单点入职年份（非任职全表）
```

### 5.5 多问 slots×N（原 composite 多槽）

```text
user: "我叫什么？今年多大？做过哪些项目？"

LLM retrievalPlan: [
  { label:"姓名", searchQuery:"个人简介 简历 姓名", queryType:"identity" },
  { label:"年龄", searchQuery:"个人简介 简历 年龄", queryType:"identity" },
  { label:"项目经历", searchQuery:"项目经历 全部项目", queryType:"enumeration" },
  ...
]

guard_检索计划: canonicalize 各 plan 项（检索 hits 缓存 对齐）

guard_复合路由:
  routeMode: slots
  compositeSlots: [槽1, 槽2, 槽3, ...]   # length ≥ 2 → Analyst 分段

→ retrieval 多槽并行 → analyst 分段写（length ≥ 2）
```

### 5.6 用户记忆

```text
user: "我的qq是734858469，请帮我记住"

LLM:
  intent: remember_user_fact
  userFactKey: qq
  userFactLabel: QQ号
  userFactValue: 734858469

guard_用户记忆: matched（intent = remember | recall）

→ routeAfterIntake → ../user-fact/ userFactNode → Mem0 写入 → answer 确认话术
→ 无 KM / analyst
```

### 5.7 同问短路（已迁至 `prepare-turn-start`）

```text
history 中已有:
  user: "城管平台用了什么 technology"
  assistant: "（长答…）"
  user: "城管平台用了什么 technology"   ← 同句再问

prepareTurnStart 节点内 findRepeatAnswerInHistory → 直接返回答案
→ 跳过 Intake LLM / KM / FC / Analyst
→ SSE 仅 prepare_turn_start step；repeatQuestionHit: true
```

### 5.8 LLM JSON 解析失败

```text
LLM 返回非 JSON / Zod 校验失败

优先：散文含反问 → clarifyFallbackFromProse
否则 defaultIntakeDecision():
  intent: clarify
  clarifyingQuestion: 「刚才没听清…」
  retrievalPlan: []

→ pipeline clarify 早退（不发明 retrieve / 不包 1 槽）
```

---

## 6. 各目录 / 文件职责

### contract/

| 文件 | 职责 |
|------|------|
| `prompt.ts` | `IntakeRoutingDecision` 类型定义；系统 Prompt（意图规则、few-shot 示例） |
| `schema.ts` | Zod schema；`parseIntakeRoutingDecision()`；snake_case 字段兼容 |

### llm/

| 文件 | 职责 |
|------|------|
| `ollama-chat.ts` | 组 LangChain messages → 调 Ollama → 返回原始 JSON 字符串 |

### pipeline/

| 文件 | 职责 |
|------|------|
| `intake-pipeline.ts` | LLM 之后：parse → guard 链 → `RoutedIntakeDecision`；分步打日志 |
| `parse-intake.ts` | 解析 LLM JSON；解析失败 → `defaultIntakeDecision`（**clarify**，不发明 retrieve） |

### nodes/

| 文件 | 职责 |
|------|------|
| `intake-node.ts` | 入口短路（社交/单字）→ 原文 LLM →（未消解则拼接重试 1×）→ `runIntakePipeline()` |

> respondEarly / userFact 已迁出本目录：`../respond-early/`、`../user-fact/`。

### guards/

| 文件 | 职责 |
|------|------|
| `intake-continuation-guard.ts` | 恒 noop（指代归 LLM + node merge） |
| `intake-link-lookup-guard.ts` | `external_link` harmonize；不发明 multipart 拆槽 |
| `intake-chitchat-guard.ts` | chitchat 注入 briefReply；`applyPureSocialUtteranceGuard` 供 node/verify |
| `intake-retrieval-plan-guard.ts` | schema 合法化 + facet 去重 + canonicalize（保留非空 searchQuery） |
| `composite-route-guard.ts` | plan → slots；空 plan → clarify |
| `enumeration-list-intent.ts` | 列举分页 intent（preview / continue / exhaustive） |

### composite/

| 文件 | 职责 |
|------|------|
| `composite-routing.ts` | `resolveCompositeRoute()`：仅编译 LLM `retrievalPlan` → slots |
| `composite-slot-queries.ts` | 槽模板；planItem → slot；canonicalizePlanItem |
| `enumeration-target.ts` | 列举问是「公司」还是「项目」 |

> 槽答案缓存 / 增量计划在 `knowledge-manager/composite/`（`incremental-plan.ts`、`facet-key.ts`）。

### user-fact/

| 文件 | 职责 |
|------|------|
| `user-fact.ts` | remember/recall 解析；Mem0 读写辅助；确认/缺失话术 |

---

## 7. 对外 API（`index.ts`）

外部代码**只应** import：

```typescript
import {
  completeIntakeCoordinator,
  runIntakePipeline,
  type IntakeRoutingDecision,
  type RoutedIntakeDecision,
} from "@/agentflow/agents/online/intake-coordinator";

// 同问短路已迁至 prepare-turn-start；兼容 re-export：
import { findRepeatAnswerInHistory } from "@/agentflow/agents/online/prepare-turn-start";
```

Pipeline 内主要调用点：

| 调用方 | 使用的 Intake / Prepare 导出 |
|--------|---------------------------|
| `pipeline/graph/compile.ts` | `runPrepareTurnStart`（prepare-turn-start）；`runIntakeNode` 等节点委托 |
| `pipeline/runtime/stream.ts` | SSE 消费；**不**再直接调同问短路/Mem0 |
| `pipeline/graph/state.ts` | `RoutedIntakeDecision`, `IncrementalCompositePlan` |
| `user-fact/nodes/user-fact-node.ts` | userFact 图节点 |
| `intake-coordinator/pipeline/parse-intake.ts` | `parseIntakeDecision`, `defaultIntakeDecision` |
| `knowledge-manager/recall/retrieve.ts` | `resolveEnumerationTarget`（列举扫盘） |
| `information-analyst/*` | composite 槽类型、enumeration 辅助 |

---

## 8. Web 复盘测试句（Golden 对齐）

| # | 输入 | 验证点 |
|---|------|--------|
| 1 | `你好` | chitchat；无 retrieval |
| 2 | `我的名字` | identity；有 retrieval |
| 3 | `城管平台用了什么技术` | tech；**slots×1** |
| 4 | `我在哪几家公司上过班？` | enumeration |
| 5 | `那个项目呢？`（单轮） | clarify |
| 6 | 上轮问城管技术 → `那个项目呢？` | 指代补全；有 retrieval |
| 7 | `我的qq是734858469` | user_fact remember |
| 8 | 新对话 `我的qq是多少` | user_fact recall |
| 9 | `我叫什么，我做过什么项目，我在那几家公司上过班，近两年在干什么？` | **slots×N**（多槽并行） |
| 10 | 第 9 句原样再问 | 同问短路 |

对应 eval 定义：`apps/brain-service/scripts/eval/golden.json`（G1～G5c、GMem、profileProbe）。

---

## 9. 相关脚本

```bash
pnpm --filter @fambrain/brain-service run verify:intake-chitchat
pnpm --filter @fambrain/brain-service run verify:intake-coreference
pnpm --filter @fambrain/brain-service run verify:composite-route
pnpm --filter @fambrain/brain-service run verify:user-fact
pnpm --filter @fambrain/brain-service run golden:regression   # G1～G5c + GMem
```

---

## 10. 与下游 Agent 的字段交接

| Intake 产出字段 | 下游消费者 |
|----------------|-----------|
| `decision.searchQuery` + `queryType` + `topics` | KnowledgeManager（**slots×1** 时与多槽同路径） |
| `decision.compositeSlots[]` | KM 分槽并行（1～N 槽）+ Analyst 分段（≥2 槽时） |
| `decision.intent === summarize_content` | ContentSummarizer |
| `intent` remember/recall | [`../user-fact/`](../user-fact/) → Mem0 |
| `decision.clarifyingQuestion` / `briefReply` | respondEarly → 直接 answer |
| `decision.coverage` 等 | **不产** — 由 KM 写入 state |

Intake 写入 Pipeline 状态的字段：`state.decision`（类型 `RoutedIntakeDecision | null`）。  
可选标记：`state.repeatQuestionHit`（同问短路，在 prepareTurnStart 节点设置）。
