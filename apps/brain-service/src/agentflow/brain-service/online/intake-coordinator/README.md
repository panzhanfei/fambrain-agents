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
├── nodes/                 ← LangGraph 图节点（仅 intake）
│   └── intake-node.ts     # runIntakeNode()
│
├── guards/                ← LLM 之后的规则兜底
│   ├── intake-chitchat-guard.ts
│   ├── intake-retrieval-plan-guard.ts
│   └── intake-user-fact-guard.ts
│
├── composite/             ← 多问 / 分槽 / L3-L4 增量
│   ├── composite-routing.ts
│   ├── composite-route-guard.ts
│   ├── composite-slot-queries.ts
│   ├── composite-facet-key.ts
│   ├── composite-incremental.ts
│   └── enumeration-target.ts
│
└── user-fact/             ← 已迁至 ../user-fact/
```

### 推荐阅读顺序

1. `pipeline/intake-pipeline.ts` — guard 链顺序（5 分钟建立全局观）
2. `contract/prompt.ts` — 字段含义 + Prompt 规则
3. `guards/*` — 每条规则改什么
4. `composite/*` — 多问怎么拆槽
5. `llm/ollama-chat.ts` — LLM 输入输出

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
    ├─ retrieval       → knowledge-manager/pipeline-retrieval → … → analyst → persistTurnEnd
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
    ▼ LLM指代决策（透传 + 日志）       pipeline/intake-pipeline.ts
    │   clarify → pipeline 早退（跳过 plan/composite）
    │
    ▼ applyIntakeChitchatGuard()         guards/intake-chitchat-guard.ts
    │   chitchat/out_of_scope → pipeline 早退
    │
    ▼ routeUserFactFromIntake()          user-fact/user-fact.ts
    │   命中 → applyUserFactFromIntake() → 最终路由（不经 composite）
    │
    ▼ applyIntakeRetrievalPlanGuard()    guards/intake-retrieval-plan-guard.ts
    │
    ▼ applyCompositeRouteGuard()         composite/composite-route-guard.ts
    │
    ▼ RoutedIntakeDecision → state.decision
```

### 3.3 Web 运行日志里 Intake 的标签

| label | 对应步骤 |
|-------|----------|
| `进入` | LLM 调用前：userQuestion、history 轮数 |
| `出去` | LLM 原始 JSON 预览 |
| `同问短路` | 同句再问命中 |
| `解析LLM输出` | parse 成功 / fallback |
| `LLM指代决策` | LLM 指代/澄清 intent；clarify 时标记 earlyExit |
| `guard_闲聊` | chitchat 注入固定 briefReply |
| `guard_用户记忆` | remember / recall |
| `guard_检索计划` | retrievalPlan 补全 / canonicalize |
| `guard_复合路由` | routeMode、槽位列表 |
| `最终路由` | 交给下游的 decision 摘要 |

---

## 4. 数据结构

Intake 产出两层结构：**LLM 层** `IntakeRoutingDecision` → **编排层** `RoutedIntakeDecision`。

### 4.1 `IntakeRetrievalPlanItem`（多问时的单条检索计划）

定义：`contract/prompt.ts`

| 字段 | 类型 | 含义 | 谁消费 |
|------|------|------|--------|
| `label` | string | 子问题摘要，如「姓名」「项目经历」 | Analyst 分段标题；composite 槽 label |
| `searchQuery` | string | 该子问题专用检索词（含目录词如「个人简介 简历」） | KM 检索；L2 cache key 的一部分 |
| `queryType` | identity \| enumeration \| tech \| default | 该子问题的检索 profile | KM `queryProfile` |
| `topics` | string[] | 语料主题 hint，如 personal / project | KM 过滤 / 精排 |

### 4.2 `IntakeRoutingDecision`（LLM 工单 — 核心）

定义：`contract/prompt.ts`，校验：`contract/schema.ts`

| 字段 | 类型 | 含义 | 典型值 / 规则 |
|------|------|------|---------------|
| **intent** | 8 种枚举 | 主意图分类 | 见下表「intent 选用」 |
| **needsRetrieval** | boolean | 是否需要 KM 查个人语料 | retrieve / summarize 多为 true；chitchat / userFact 为 false |
| **searchQuery** | string | 检索用词（去寒暄、补实体） | 如 `西安奥卡云 城市管理平台 技术栈 React` |
| **subTasks** | string[] | 子任务标签 | 多问时与 retrievalPlan 对齐 |
| **topics** | string[] | 语料主题标签 | personal, resume, project, experience, tech-stack… |
| **language** | zh \| en \| mixed | 用户语言 | Analyst / 短答话术 |
| **confidence** | 0–1 | 模型对路由的把握 | 日志 / eval 用 |
| **queryType** | identity \| enumeration \| tech \| default \| null | 检索问法类型 | 与 KM `queryProfile` 对齐；不检索时为 null |
| **clarifyingQuestion** | string \| null | 澄清追问（只问一个） | 仅 intent=clarify 时填 |
| **briefReply** | string \| null | 极短直接回复（≤80 字） | chitchat / clarify；**needsRetrieval=true 时必须 null** |
| **retrievalPlan** | IntakeRetrievalPlanItem[] | 多问并列时每项一次检索 | 单问为 `[]`；≥2 项触发 composite |
| **userFactKey** | string \| null | 记忆字段 slug | qq / wechat / phone / email / dingtalk… |
| **userFactLabel** | string \| null | 展示名 | 「QQ号」「微信号」 |
| **userFactValue** | string \| null | remember 时的值 | recall 时为 null |

#### intent 选用速查

| intent | 何时 | needsRetrieval |
|--------|------|----------------|
| `retrieve_and_answer` | 问经历、项目、技术栈、简历字段 | true |
| `summarize_content` | 用户要总结/概括某段经历或文档 | 通常 true |
| `direct_answer` | 通用概念，与用户履历无关 | false |
| `clarify` | 指代不明且 history 无法推断实体 | false |
| `chitchat` | 问候、感谢、闲聊 | false |
| `out_of_scope` | 应拒绝的请求 | false |
| `remember_user_fact` | 「记住我的 QQ 是…」 | false |
| `recall_user_fact` | 「我的 QQ 是多少」 | false |

#### queryType 速查

| queryType | 何时 | searchQuery 示例 |
|-----------|------|------------------|
| `identity` | 姓名、年龄、学历、行业 | `个人简介 简历 姓名` |
| `enumeration` | 列举公司 / 全部项目 | `哪几家公司 工作经历` |
| `tech` | 技术栈、框架 | `城管平台 技术栈 React` |
| `default` | 其他单点事实 | `西安奥卡云 工作职责` |

### 4.3 `RoutedIntakeDecision`（guard 后的编排工单）

定义：`composite/composite-route-guard.ts`  
= `IntakeRoutingDecision` + 下列扩展字段

| 字段 | 类型 | 含义 |
|------|------|------|
| **routeMode** | single \| composite \| slot | 下游检索模式 |
| **compositeSlots** | CompositeRetrievalSlot[] | 分槽列表（≥2 → composite） |
| **routeReason** | CompositeRouteReason | 为何这样路由（可观测） |
| **routePlanSource** | CompositeRoutePlanSource | plan 来源（LLM plan / 结构兜底…） |
| **userFact** | UserFactRoute \| null | remember/recall 路由对象 |

#### routeMode 含义

| routeMode | 条件 | 下游行为 |
|-----------|------|----------|
| `single` | 单问 / 非检索短路 | KM 一次检索，用顶层 searchQuery |
| `slot` | 恰好 1 个槽（tech 单问除外） | KM 按单槽检索 |
| `composite` | ≥2 个槽 | KM 多槽并行 + Analyst 分段写 |

#### routeReason 枚举

| 值 | 含义 |
|----|------|
| `skip_non_retrieve` | chitchat / userFact / clarify 等不检索 |
| `intake_retrieval_plan` | 来自 LLM 的 retrievalPlan |
| `intake_subtasks_fallback` | subTasks ≥2 兜底 |
| `structural_multipart_fallback` | 多问结构检测兜底 |
| `query_type_template` | queryType 模板槽 |
| `single_default` | 普通单问 |

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
  needsRetrieval: true
  searchQuery: "西安奥卡云 城市管理平台 技术栈 React TypeScript"
  queryType: tech
  retrievalPlan: []

guard 链: 通常 noop（无指代/非闲聊/非 userFact）

RoutedIntakeDecision:
  routeMode: single
  compositeSlots: []

→ routeAfterIntake → retrieval → KM(searchQuery, queryType=tech)
```

### 5.2 闲聊：「你好」

```text
LLM:
  intent: chitchat
  needsRetrieval: false
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
  needsRetrieval: false

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
  needsRetrieval: true

pipeline:
  LLM指代决策 → earlyExit=false
  → retrievalPlan → composite → retrieval → analyst
```

### 5.5 多问 composite

```text
user: "我叫什么？今年多大？做过哪些项目？"

LLM retrievalPlan: [
  { label:"姓名", searchQuery:"个人简介 简历 姓名", queryType:"identity" },
  { label:"年龄", searchQuery:"个人简介 简历 年龄", queryType:"identity" },
  { label:"项目经历", searchQuery:"项目经历 全部项目", queryType:"enumeration" },
  ...
]

guard_检索计划: canonicalize 各 plan 项（L2 cache 对齐）

guard_复合路由:
  routeMode: composite
  compositeSlots: [槽1, 槽2, 槽3, ...]

→ retrieval 多槽并行 → analyst 分段写
```

### 5.6 用户记忆

```text
user: "我的qq是734858469，请帮我记住"

LLM:
  intent: remember_user_fact
  userFactKey: qq
  userFactLabel: QQ号
  userFactValue: 734858469

guard_用户记忆: matched
applyUserFactFromIntake → userFact: { action:"remember", factKey:"qq", ... }

→ userFact 节点 → Mem0 写入 → answer 确认话术
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
  needsRetrieval: true
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
| `intake-pipeline.ts` | parse → LLM指代决策（透传/clarify 早退）→ guard 链 |
| `intake-chitchat-guard.ts` | chitchat 注入服务端固定 briefReply |
| `intake-retrieval-plan-guard.ts` | 多问补 retrievalPlan；canonicalize 对齐 L2 cache |
| `intake-user-fact-guard.ts` | userFact 路由 decision 包装，needsRetrieval=false |

### composite/

| 文件 | 职责 |
|------|------|
| `composite-routing.ts` | 多问结构检测；fallback plan；`resolveCompositeRoute()` |
| `composite-route-guard.ts` | plan → routeMode + compositeSlots |
| `composite-slot-queries.ts` | 槽模板；planItem → slot；canonicalizePlanItem |
| `enumeration-target.ts` | 列举问是「公司」还是「项目」 |
| `composite-facet-key.ts` | L3 facet cache key |
| `composite-incremental.ts` | L4 增量 composite：只检索未 cache 的槽 |

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
| `knowledge-manager/retrieve.ts` | `resolveEnumerationTarget` |
| `information-analyst/*` | composite 槽类型、enumeration 辅助 |

---

## 8. Web 复盘测试句（Golden 对齐）

| # | 输入 | 验证点 |
|---|------|--------|
| 1 | `你好` | chitchat；无 retrieval |
| 2 | `我的名字` | identity；有 retrieval |
| 3 | `城管平台用了什么技术` | tech；single 路由 |
| 4 | `我在哪几家公司上过班？` | enumeration |
| 5 | `那个项目呢？`（单轮） | clarify |
| 6 | 上轮问城管技术 → `那个项目呢？` | 指代补全；有 retrieval |
| 7 | `我的qq是734858469` | user_fact remember |
| 8 | 新对话 `我的qq是多少` | user_fact recall |
| 9 | `我叫什么，我做过什么项目，我在那几家公司上过班，近两年在干什么？` | composite 多槽 |
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
| `decision.searchQuery` + `queryType` + `topics` | KnowledgeManager（single/slot） |
| `decision.compositeSlots[]` | KM 多槽并行 + Analyst 分段 |
| `decision.intent === summarize_content` | ContentSummarizer |
| `decision.userFact` | user-fact-node → Mem0 |
| `decision.clarifyingQuestion` / `briefReply` | respondEarly → 直接 answer |
| `decision.coverage` 等 | **不产** — 由 KM 写入 state |

Intake 写入 Pipeline 状态的字段：`state.decision`（类型 `RoutedIntakeDecision | null`）。  
可选标记：`state.repeatQuestionHit`（同问短路，在 prepareTurnStart 节点设置）。
