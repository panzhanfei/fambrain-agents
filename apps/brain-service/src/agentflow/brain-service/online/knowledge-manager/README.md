# KnowledgeManager（语料检索）

KM 是 Pipeline 的**第一个纯规则在线 Agent**（图内位于 **Intake 之后**）。它把 Intake 产出的 `searchQuery / queryType / compositeSlots` 变成 **`hits / coverage / notes`**，供 FactChecker、ContentOrganizer、Analyst 消费。

**KM 不做的事：** 调 Chat LLM 精排、写最终长答、读写 Mem0、Intake 路由决策（见 [`../intake-coordinator/`](../intake-coordinator/README.md)）。

---

## 1. 设计思路

### 1.1 为什么单独做一个 Agent？

| 问题 | KM 的解法 |
|------|-----------|
| 检索与生成混在一起会编造 excerpt | **检索层零 LLM**：规则 rank + pickExcerpt |
| 向量 alone 漏关键词 / 路径权威 | **Hybrid 并行召回**（向量 ∥ BM25）→ RRF 融合 |
| identity / 列举 / tech 问法差异大 | **queryProfile 分档** topK、maxHits、guard |
| 多问 composite 重复算力 | **检索 hits 缓存** + **槽答案增量**（命中槽跳过 KM） |

### 1.2 核心原则

1. **快、稳、可回归** — 主路径确定性；日志带 `queryProfile`、`recallSource`、`confidenceTier`。
2. **Intake queryType 优先** — KM 内 `inferQueryProfile` 仅脚本 / 解析失败兜底。
3. **对外只暴露 `index.ts`** — 子目录按职责拆分；外部 import 统一走 barrel。
4. **一个 LangGraph 节点 ≈ 一个文件夹** — 图节点在 `nodes/`；多槽编排在 `composite/`；真查库在 `recall/`。

### 1.3 技术栈

| 技术 | 文件 | 用途 |
|------|------|------|
| Chroma 向量 | `@fambrain/corpus` | 向量语义召回 |
| BM25 sparse | `@fambrain/corpus` | 关键词召回 |
| RRF | `recall/fusion-rrf.ts` | RRF 融合排序 |
| Redis / memory | `@fambrain/infra` | 检索 hits 缓存 |
| Zod | `contract/schema.ts` | hits 结构校验 |

---

## 2. 目录地图（点进来先看这个）

```text
knowledge-manager/
├── README.md              ← 本文件
├── index.ts               ← 对外 API（外部只 import 这里）
│
├── contract/              ← 数据合同
│   ├── types.ts           # KnowledgeHit / KnowledgeRetrievalResult / Candidate
│   └── schema.ts          # Zod 校验 hits / coverage
│
├── nodes/                 ← LangGraph 图节点（仅 retrieval）
│   └── retrieval-node.ts  # runRetrievalNode()
│
├── composite/             ← 多槽增量检索（对应 Intake compositeSlots）
│   ├── facet-key.ts
│   ├── incremental-plan.ts
│   ├── retrieve.ts
│   ├── slots-parallel.ts
│   ├── retrieve-with-cache.ts
│   ├── merge.ts
│   └── index.ts
│
├── recall/                ← 核心检索（无 LLM）
│   ├── retrieve.ts        # retrieveKnowledge() 主入口
│   ├── hybrid-recall.ts   # 向量 ∥ sparse 并行
│   ├── fusion-rrf.ts      # RRF 融合
│   └── retrieve-helpers.ts # rank / excerpt / guard / enumeration fill
│
├── list/                  ← 列举分页（P0-22 · 2026-07）
│   ├── list-corpus-entries.ts   # 按 path 排序扫 projects|experience
│   └── retrieve-enumeration-page.ts
│
└── profile/               ← 配置与分档
    ├── km-config.ts       # topK、pathBoost、RRF 常量
    ├── query-profile.ts   # identity / enumeration / tech / default
    └── score-candidate.ts # confidenceTier 多维评估
```

业界对标见 [`docs/km-retrieval-design.md`](../../../../../../docs/km-retrieval-design.md)。

### 推荐阅读顺序

1. `nodes/retrieval-node.ts` — **slots×1 vs slots×N** 分支、检索 hits 缓存
2. `recall/retrieve.ts` — Hybrid → rank → coverage 主路径
3. `composite/` — 槽答案增量与多槽并行
4. `profile/query-profile.ts` + `profile/km-config.ts` — 分档参数
5. `recall/retrieve-helpers.ts` — identityGuard、enumerationFill

---

## 3. 文件流转路径（从 decision 到 hits）

### 3.1 总览

```text
state.decision（Intake 输出）
    │
    ▼
routeAfterIntake()                    pipeline/graph/routes.ts
    │ intent=retrieve_and_answer / summarize_content(+searchQuery)
    ▼
nodes/retrieval-node.ts               runRetrievalNode()
    │
    ├─ routeMode=list
    │     └─ retrieveEnumerationPage()   list/retrieve-enumeration-page.ts（语料 path 分页，不经 hybrid）
    │
    └─ routeMode=slots
          ├─ resolveIncrementalCompositePlan()   composite/incremental-plan.ts
          └─ retrieveCompositeIncremental()      composite/retrieve.ts
                槽答案缓存命中 → citations 还原 hits（跳过真检索）
                active 槽 → retrieveSlotWithCache → retrieveKnowledge
    │
    ▼
state.hits / coverage / notes / confidenceTier
    │
    ▼
factChecker → contentOrganizer → analyst
```

### 3.2 单槽检索（slots × 1）

与多槽共用 `retrieveCompositeIncremental`；`compositeSlots.length === 1` 时 merge 结果等价于原单问 hits。

### 3.3 单问检索内部（`retrieveKnowledge`）

```text
resolveQueryProfile(queryType, searchQuery, subTasks)
    │
    ▼
hybridRecall()              recall/hybrid-recall.ts
    vector ∥ sparse → fuseRrf()
    │
    ▼
rankCandidates + pickExcerpt    recall/retrieve-helpers.ts
    pathBoost / identityGuard / enumerationFill
    │
    ▼
assessConfidence()            profile/score-candidate.ts
deriveCoverageFromTier()
    │
    ▼
KnowledgeRetrievalResult { hits, coverage, notes, confidenceTier }
```

### 3.4 Web 运行日志里 KM 的标签

| label | 对应步骤 |
|-------|----------|
| `进入` | searchQuery、queryProfile、vectorTopK |
| `Hybrid` | vector/sparse 路数、RRF Top 路径 |
| `出去` | hitCount、coverage、confidenceTier、guardApplied |

---

## 4. 与 Intake / Pipeline 的边界

| 字段 | 谁写 | KM 怎么用 |
|------|------|-----------|
| `searchQuery` | Intake | 主检索文本；检索 hits 缓存 key 之一 |
| `queryType` | Intake | 映射 queryProfile；检索 hits 缓存 key 之一 |
| `routeMode` / `compositeSlots` | Intake composite guard | **`slots`（1～N 槽，单问=1 槽）** 或 `list`（列举分页） |
| `topics` | Intake | **仅**拼入向量 semantic query（KM-01） |
| `subTasks` | Intake | sparse token + rank 辅助 |

列举目标解析（experience / projects）在 Intake 侧：`intake-coordinator/composite/enumeration-target.ts`，KM `retrieve.ts` 调用 `resolveEnumerationTarget`。

---

## 5. 验收脚本

| 命令 | 测什么 |
|------|--------|
| `pnpm --filter @fambrain/brain-service run verify:km-retrieve` | rank / guard / enumeration 单测 |
| `pnpm --filter @fambrain/brain-service run verify:hybrid-recall` | RRF + hybrid live |
| `pnpm --filter @fambrain/brain-service run verify:composite-route` | merge composite hits |
| `pnpm --filter @fambrain/brain-service run verify:agent-schemas` | schema 合同 |
| `pnpm --filter @fambrain/brain-service run verify:retrieval-cache` | 检索 hits 缓存 normalize |
| `pnpm --filter @fambrain/brain-service run verify:enumeration-compose` | P0-22 列举 blocks + skip LLM + 序号/文案 |
| `pnpm --filter @fambrain/brain-service run verify:enumeration-pagination` | 续问路由 + 分页 API + 槽答案 blocks |
| `pnpm exec tsx --env-file=../../.env scripts/diagnose-projects-query.ts` | 语料 36 项 vs KM/Organizer/规则路径 |

**HTTP（brain-service）：** `POST /enumeration/list` — body `{ corpusUserId, listKind, page, pageSize }`；Web BFF：`POST /api/corpus/enumeration`。
