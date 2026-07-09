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
| 多问 composite 重复算力 | **L2 检索 cache** + **L3 facet 增量**（命中槽跳过 KM） |

### 1.2 核心原则

1. **快、稳、可回归** — 主路径确定性；日志带 `queryProfile`、`recallSource`、`confidenceTier`。
2. **Intake queryType 优先** — KM 内 `inferQueryProfile` 仅脚本 / 解析失败兜底。
3. **对外只暴露 `index.ts`** — 子目录按职责拆分；外部 import 统一走 barrel。
4. **一个 LangGraph 节点 ≈ 一个文件夹** — 图节点在 `nodes/`；编排逻辑在 `pipeline/`。

### 1.3 技术栈

| 技术 | 文件 | 用途 |
|------|------|------|
| Chroma 向量 | `@fambrain/corpus` | L1a 语义召回 |
| BM25 sparse | `@fambrain/corpus` | L1b 关键词召回 |
| RRF | `recall/fusion-rrf.ts` | L1c 融合排序 |
| Redis / memory | `@fambrain/infra` | L2 检索结果 cache |
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
├── pipeline/              ← cache + composite 编排
│   ├── retrieve-with-cache.ts           # 单槽 L2 cache 包装
│   ├── retrieve-slots-parallel.ts       # composite 全槽并行 KM
│   ├── retrieve-composite-incremental.ts # L3 命中槽跳过 KM
│   └── merge-composite-retrieval.ts     # 子问 hits 合并
│
├── recall/                ← 核心检索（无 LLM）
│   ├── retrieve.ts        # retrieveKnowledge() 主入口
│   ├── hybrid-recall.ts   # 向量 ∥ sparse 并行
│   ├── fusion-rrf.ts      # RRF 融合
│   └── retrieve-helpers.ts # rank / excerpt / guard / enumeration fill
│
└── profile/               ← 配置与分档
    ├── km-config.ts       # topK、pathBoost、RRF 常量
    ├── query-profile.ts   # identity / enumeration / tech / default
    └── score-candidate.ts # confidenceTier 多维评估
```

业界对标与 Wave 计划见 [`docs/km-retrieval-design.md`](../../../../../../docs/km-retrieval-design.md)。

### 推荐阅读顺序

1. `nodes/retrieval-node.ts` — 单问 vs composite 分支、L2 cache
2. `recall/retrieve.ts` — Hybrid → rank → coverage 主路径
3. `pipeline/retrieve-composite-incremental.ts` — L3 facet 增量
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
    ├─ routeMode=single
    │     ├─ getRetrievalFromCache()     L2 命中 → 直接返回 hits
    │     └─ retrieveKnowledge()         recall/retrieve.ts
    │           hybridRecall → rank → confidenceTier
    │     └─ setRetrievalCache()
    │
    └─ routeMode=composite | slot
          ├─ resolveIncrementalCompositePlan()   intake-coordinator/composite/
          └─ retrieveCompositeIncremental()      pipeline/
                L3 命中槽 → citations 还原 hits（跳过 KM）
                active 槽 → retrieveSlotWithCache → retrieveKnowledge
    │
    ▼
state.hits / coverage / notes / confidenceTier
    │
    ▼
factChecker → contentOrganizer → analyst
```

### 3.2 单问检索内部（`retrieveKnowledge`）

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

### 3.3 Web 运行日志里 KM 的标签

| label | 对应步骤 |
|-------|----------|
| `进入` | searchQuery、queryProfile、vectorTopK |
| `Hybrid` | vector/sparse 路数、RRF Top 路径 |
| `出去` | hitCount、coverage、confidenceTier、guardApplied |

---

## 4. 与 Intake / Pipeline 的边界

| 字段 | 谁写 | KM 怎么用 |
|------|------|-----------|
| `searchQuery` | Intake | 主检索文本；L2 cache key 之一 |
| `queryType` | Intake | 映射 queryProfile；L2 cache key 之一 |
| `routeMode` / `compositeSlots` | Intake composite guard | 决定 single vs 增量 composite |
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
| `pnpm --filter @fambrain/brain-service run verify:retrieval-cache` | L2 cache normalize |
