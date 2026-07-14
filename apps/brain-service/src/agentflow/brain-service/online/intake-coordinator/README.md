# IntakeCoordinator（入口接线员）

Intake 是 Pipeline 的**第一个 LLM 在线 Agent**（图内位于 **`prepareTurnStart` 之后**）。它把用户自然语言变成一张**结构化路由工单**，告诉下游「要不要查库、查什么、单问还是多问分槽、还是直接短答 / 记 QQ」。

**Intake 不做的事：** 检索语料、事实核查、写最终长分析、读写数据库、同问短路、Mem0/LangMem 加载（见 `../prepare-turn-start/`）。

---

## 1. 设计思路

### 1.1 为什么单独做一个 Agent？

| 问题 | Intake 的解法 |
|------|---------------|
| 下游 KM / FC / Analyst 各自猜意图会冲突 | **单一决策点**：只在这里定 intent + searchQuery |
| 纯 LLM 不稳定（闲聊乱称呼、指代误判） | **LLM 理解 + 轻量 guard**（指代由 prompt 负责；闲聊/plan 等规则兜底） |
| 多问并列难检索 | **retrievalPlan → composite 多槽**，每槽独立 KM |
| 用户口述 QQ/微信不在简历里 | **userFact 分支**，走 Mem0，不经 KM |
| 同句再问浪费算力 | **同问短路** 在 **`prepare-turn-start`** 节点（Intake 不再重复检） |

### 1.2 核心原则

1. **宁可多检索，不要漏检索** — 简历/经历类问题默认 `retrieve_and_answer`。
2. **结构化输出** — LLM 只产 JSON，不写 Markdown 长文。
3. **规则只纠偏，不替代 LLM** — guard 在 LLM 之后跑，改 decision 的个别字段。
4. **对外只暴露 `index.ts`** — 子目录是内部实现，外部 import 统一走 barrel。

### 1.3 技术栈

| 技术 | 文件 | 用途 |
|------|------|------|
| LangChain `ChatOllama` | `llm/ollama-chat.ts` | 调本地 Ollama（模型名见 `getBrainServiceConfig().ollama.models.intakeCoordinator`） |
| Zod | `contract/schema.ts` | 校验 / 规范化 LLM 输出的 JSON |
| 正则 + 纯函数 guard | `guards/*` | 闲聊、plan 补全、userFact 短路 |
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
├── query-signals.ts       ← 问句结构工具（编号/并列/过期 plan；无意图词表）
│
├── nodes/                 ← LangGraph 图节点（仅 intake）
│   └── intake-node.ts     # runIntakeNode()
│
├── guards/                ← LLM 之后的规则兜底
│   ├── intake-continuation-guard.ts
│   ├── intake-link-lookup-guard.ts
│   ├── intake-chitchat-guard.ts
│   ├── intake-retrieval-plan-guard.ts
│   ├── composite-route-guard.ts
│   └── enumeration-list-intent.ts
│
├── composite/             ← 多问 / 分槽规划（routing、槽模板）
│   ├── composite-routing.ts
│   ├── composite-slot-queries.ts
│   └── enumeration-target.ts
```

用户自述记忆见同级目录 [`../user-fact/`](../user-fact/README.md)。

### 推荐阅读顺序
2. `contract/prompt.ts` — 字段含义 + Prompt 规则
3. `guards/*` — 每条规则改什么
4. `composite/*` — 多问怎么拆槽
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
    ├─ completeIntakeCoordinator()          llm/ollama-chat.ts
    │       输入: intakeHistory + memoryBlock + contract/prompt
    │       输出: 原始 JSON 字符串
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
    ▼ parseIntakeDecision() / defaultIntakeDecision()
    │   contract/schema.ts + pipeline/parse-intake.ts
    │
    ▼ applyIntakeContinuationGuard()     guards/intake-continuation-guard.ts
    │   短省略续问 / 历史含 URL → retrieve（在 clarify 早退之前）
    │
    ▼ LLM指代决策（透传 + 日志）       pipeline/intake-pipeline.ts
    │   clarify → pipeline 早退（跳过 plan/composite）
    │
    ▼ applyIntakeChitchatGuard()         guards/intake-chitchat-guard.ts
    │   chitchat/out_of_scope → pipeline 早退
    │
    ▼ isUserFactIntent → pipeline 早退
    │   （解析在 ../user-fact/nodes/user-fact-node.ts）
    │
    ▼ applyIntakeLinkLookupGuard()       guards/intake-link-lookup-guard.ts
    │   queryType=external_link：stale multipart → 单槽；编号行 → 分实体槽
    │
    ▼ applyIntakeRetrievalPlanGuard()    guards/intake-retrieval-plan-guard.ts
    │
    ▼ applyCompositeRouteGuard()         guards/composite-route-guard.ts
    │
    ▼ applyEnumerationListIntentGuard()  guards/enumeration-list-intent.ts
    │
    ▼ RoutedIntakeDecision → state.decision
```

详见坑点 [§2.5.9 GitHub 对外链接](../../../../../../../docs/04-pitfalls.md#259-简历-github--对外链接问法-p0-25--2026-07)（P0-25）。

### 3.4 单问 / 多问统一（`routeMode=slots` · 2026-07）

早期文档曾写 `routeMode` 为 `single` / `slot` / `composite` 三档；**现已合并**：凡需 KM 检索 → **`routeMode=slots`**，`compositeSlots.length` **1～N**。单问只是 **1 槽的 slots**，多问是 **≥2 槽的 slots**，下游 KM / Analyst 共用同一套分槽并行 + merge 路径。

```text
applyCompositeRouteGuard
    │
    ├─ resolveCompositeRoute() → slots.length ≥ 1
    │       → applySlotsDecision(slots)     # 1～N 槽，routeMode 恒为 slots
    │
    └─ slots.length === 0
            → decisionToRetrievalSlot()     # 包装为 1 槽 slots_default
```

**为何合并：** 单问、多问原先在 KM / cache / Analyst 分叉（single vs composite），重复逻辑多；统一后 cache key、日志、verify 脚本只需看 `compositeSlots.length`。

### 3.5 单问 ↔ 多问结构对齐（`query-signals.ts`）

LLM 的 `retrievalPlan` / `subTasks` 可能**与当前问句不一致**（尤其多轮会话 inherited plan）。guard 用**结构信号**对齐，**不用** github/开源 等意图词表：

| 函数 | 判断什么 | 典型用途 |
|------|----------|----------|
| `hasExplicitMultipartStructure(q)` | ≥2 编号行，或 ≥2 问号/并列 | 当前问句是否**真**多问 |
| `hasStaleMultipartFromDecision(d, q)` | plan≥2 或 subTasks≥2，但问句**无**并列结构 | **过期 plan** → 应收束 |
| `extractNumberedPlanUnits(q)` | 从 `1.` `2.` 行提取子问 label | 按实体拆槽 |
| `decisionRequestsExternalLink(d)` | LLM 已标 `external_link` | link guard 入口，不在 guard 猜意图 |

**`applyIntakeLinkLookupGuard` 收束 / 展开：**

| 问句 | LLM 输出 | guard 结果 | `linkLookupGuardReason` |
|------|----------|------------|-------------------------|
| 「开源两个项目 github 都给我」（单句） | plan 2 项（物联网、工具库） | **收束 1 槽** + `EXTERNAL_LINK_SLOT` | `aggregate_external_link` |
| 同上 + 正文含 `1. … 2. …` 两行 | plan 空或任意 | **展开 2 槽**，每槽 entity + 对外链接 canonical query | `multipart_external_link` |
| 单句 external_link | queryType 已对 | 补全 searchQuery / topics | `single_external_link` / `harmonize_query_type` |

⑤ `applyIntakeRetrievalPlanGuard` 只做**多问补 plan**（`filled_fallback`）与 canonicalize，**不**收束 stale plan（收束在 profile 专用 guard，如 link lookup）。

**验证：**

```bash
pnpm --filter @fambrain/brain-service run verify:intake-link-lookup   # 收束 + 展开 + 续问
pnpm --filter @fambrain/brain-service run verify:composite-route        # 1 槽 / N 槽 slots 路由
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
| `guard_检索计划` | retrievalPlan 补全 / canonicalize |
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
| **retrievalPlan** | IntakeRetrievalPlanItem[] | 多问并列时每项一次检索 | 单问常为 `[]`；≥2 项 → **slots 多槽**（与 1 槽同属 `routeMode=slots`） |
| **userFactKey** | string \| null | 记忆字段 slug | qq / wechat / phone / email / dingtalk… |
| **userFactLabel** | string \| null | 展示名 | 「QQ号」「微信号」 |
| **userFactValue** | string \| null | remember 时的值 | recall 时为 null |

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
| `skip_non_retrieve` | chitchat / userFact / clarify 等不检索 |
| `intake_retrieval_plan` | 来自 LLM 的 retrievalPlan |
| `intake_subtasks_fallback` | subTasks ≥2 兜底 |
| `structural_multipart_fallback` | 多问结构检测兜底 |
| `query_type_template` | queryType 模板槽 |
| `slots_default` | 单问 fallback 包装为 1 槽 |

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
LLM（读 history）:
  intent: clarify
  clarifyingQuestion: "你指的是哪一段经历或哪个项目？…"
  
pipeline:
  LLM指代决策 → earlyExit=true
  → 跳过 retrievalPlan / composite

→ routeAfterIntake → respondEarly
```

### 5.4 有上下文指代（G5b）

```text
history:
  user: "城管平台用了什么技术"
  assistant: "React TypeScript UniApp…"
  user: "那个项目呢？"

LLM:
  intent: retrieve_and_answer
  searchQuery 含「城市管理平台 …」（禁止留指代词）
  
pipeline:
  LLM指代决策 → earlyExit=false
  → retrievalPlan → composite → retrieval → analyst
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

defaultIntakeDecision(userQuestion):
  intent: retrieve_and_answer
    searchQuery: userQuestion（原句）
  queryType: inferQueryProfile(...)
  retrievalPlan: 多问结构时 buildFallbackRetrievalPlan

→ 仍尽量走检索，confidence=0.4
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
| `parse-intake.ts` | 解析 LLM JSON；解析失败时 `defaultIntakeDecision` 兜底 |

### nodes/

| 文件 | 职责 |
|------|------|
| `intake-node.ts` | LangGraph intake 节点：调 LLM + `runIntakePipeline()` |
| `respond-early-node.ts` | clarify / chitchat / 同问短路终稿 |
| `user-fact-node.ts` | remember / recall → Mem0 |

### guards/

| 文件 | 职责 |
|------|------|
| `intake-continuation-guard.ts` | 省略续问 / 历史含 URL → retrieve（P0-25） |
| `intake-link-lookup-guard.ts` | `external_link`：stale multipart 收单槽、编号行分实体（P0-25） |
| `intake-chitchat-guard.ts` | chitchat 注入服务端固定 briefReply |
| `intake-retrieval-plan-guard.ts` | 多问补 retrievalPlan；canonicalize 对齐 检索 hits 缓存 |
| `composite-route-guard.ts` | plan → routeMode + compositeSlots |
| `enumeration-list-intent.ts` | 列举分页 intent（preview / continue / exhaustive） |

### composite/

| 文件 | 职责 |
|------|------|
| `composite-routing.ts` | 多问结构检测；fallback plan；`resolveCompositeRoute()` |
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
} from "@/agentflow/brain-service/online/intake-coordinator";

// 同问短路已迁至 prepare-turn-start；兼容 re-export：
import { findRepeatAnswerInHistory } from "@/agentflow/brain-service/online/prepare-turn-start";
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

对应 eval 定义：`apps/brain-service/scripts/eval/golden.json`（G1～G5b、GMem、profileProbe）。

---

## 9. 相关脚本

```bash
pnpm --filter @fambrain/brain-service run verify:intake-chitchat
pnpm --filter @fambrain/brain-service run verify:intake-coreference
pnpm --filter @fambrain/brain-service run verify:composite-route
pnpm --filter @fambrain/brain-service run verify:user-fact
pnpm --filter @fambrain/brain-service run golden:regression   # G1～G5b + GMem
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
