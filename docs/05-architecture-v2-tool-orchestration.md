# 架构 v2：四类数据源与工具编排

[← 返回 README](../README.md) · [Agent 流程图](./02-agent-flows.md) · [坑点清单](./04-pitfalls.md)

本文记录 **2026-07** 从 Classic RAG 演进到 **四类问题架构** 的动机、提交链路与实现要点。触发原因是 **年龄计算**（P0-23）暴露了「Analyst 内联硬编码工具」的架构债。

---

## 1. 为什么要改？

### 1.1 导火索：「我今年多大」

| 阶段 | 现象 | 问题 |
|------|------|------|
| P0-15/18 | Analyst prompt **禁止 LLM 自行推算年龄** | 防幻觉正确 |
| P0-23 初版 | `compute_age_from_hits` 写在 **Analyst 内**（`resolveOrchestratedTool`） | 工具层与归纳层耦合；Intake 无 `toolPlan` |
| 用户期望 | 行业惯例：**Intake 规划 → KM 检索 → Tool 执行 → Analyst 只写稿** | 与 LangChain Tool + Orchestrator 分层一致 |

**结论：** 年龄不是「多写一个 regex」能解决的单点 bug，而是缺少 **声明式工具编排层**。本次重构把 P0-23 的能力 **上移到独立 LangGraph 节点**，并顺带落地四类数据源分流。

### 1.2 目标架构（四类）

| 类别 | 示例 | 路径 | LangGraph |
|------|------|------|-----------|
| ① 静态知识 | 文档里写了什么政策 | 本地向量库（Chroma + BM25） | `retrieval` → KM |
| ② 个人信息 / 计算 | 我今年多大 | 语料检索 + **计算工具** | KM → `toolOrchestrator` → `compute_age_from_hits` |
| ③ 实时动态 | xxx 公司最近怎么样 | **联网搜索**（corpus-first） | KM 弱命中 → `search_web` |
| ④ 混合 | 根据简历 + 行情评估去某公司机会 | **DAG 编排** | `dagExecutor` 并行语料+联网 → `synthesize_merge` → Analyst |

**原则：** 尽量少硬编码口语；字段 → 工具映射集中在 **`field-catalog.ts`**，Intake guard 只 **富化计划**，不算答案。

---

## 2. Git 提交链路（大版本脉络）

| 提交 | 主题 | 与本次关系 |
|------|------|------------|
| `ab25432` | P0-22 列举分页（`listIntent` / `enumerationPage`） | Intake guard ⑦ 模式 → 本次 guard ⑧ `applyToolPlanGuard` 同级扩展 |
| `c0614e9` | P0-23 年龄编排工具 + `search_web` stub | **触发架构债**；工具逻辑先在 Analyst 内联 |
| **（本次未提交）** | P0-24 四类架构 + `toolOrchestrator` / `dagExecutor` | 将 P0-23 上移到编排节点；落地 Tavily `search_web` |
| **（2026-07）** | P0-26 列举 **per-slot** + 代码布局 `agents/` / `tool-orchestrator/` | 废弃整句 `routeMode=list`；ToolOrchestrator 移入 `agents/online/` |

更早基础：`aec9cdb`（`retrieve_and_answer` 决定是否进 KM）、`c466a28`（LangGraph 纯化）、`12a6b13`（Intake 节点拆分）。

---

## 3. 新 Pipeline 拓扑

```mermaid
flowchart TD
  IC[IntakeCoordinator<br/>guard ⑧ applyToolPlanGuard] --> R{routeAfterIntake}

  R -->|routeMode=dag| DAG[DagExecutor<br/>并行 retrieve_corpus + search_web]
  R -->|retrieve_and_answer| KM[KnowledgeManager retrieval]
  R -->|其它| EARLY[respondEarly / userFact / summarizer]

  DAG --> FC[FactChecker]
  KM --> FC
  FC --> CO[ContentOrganizer]
  CO --> TO[ToolOrchestrator<br/>age / enumeration / web]
  TO --> IA[InformationAnalyst<br/>消费 toolResults]
```

**与 P0-23 对比：**

```
# 旧（P0-23）
Intake → KM → FC → CO → Analyst（内联 resolveOrchestratedTool + regex）

# 新（P0-24）
Intake（enrichedPlan / executionPlan）
  → KM 或 DagExecutor
  → FC → CO → ToolOrchestrator → Analyst（读 state.toolResults）
```

---

## 4. 核心模块

| 路径 | 职责 |
|------|------|
| `agents/online/tool-orchestrator/field-catalog.ts` | 声明式 identity 字段表（`age` → `compute_age_from_hits`）；混合问句 / 外部事实启发式 |
| `agents/online/tool-orchestrator/enrich-plan.ts` | `applyToolPlanGuard`：富化 `enrichedPlan`；混合问句 → `routeMode=dag` + `executionPlan` |
| `agents/online/tool-orchestrator/execute-tools.ts` | 工具执行：`invokeComputeAge`、`invokeSearchWeb`、`executeDagPlan` |
| `agents/online/tool-orchestrator/nodes.ts` | `runDagExecutorNode`、`runToolOrchestratorNode` |
| `pipeline/graph/state.ts` | 新增 `asOfDate`、`toolResults` |
| `prepare-turn-start` | 注入 `asOfDate`（年龄计算基准日） |
| `tools/search-web.ts` | Tavily API；未配置时 `status=disabled` |
| `tools/get-current-date.ts` | `get_current_date` LangChain 工具 |

### 4.1 Intake 新增字段（`RoutedIntakeDecision`）

- `enrichedPlan`：每项含 `dataSource`、`toolId`、`field`
- `primaryDataSource`：`corpus` | `web`
- `webQuery`：外部事实检索词
- `executionPlan`：混合 DAG 节点列表
- `routeMode`：新增 `"dag"`

### 4.2 状态字段

- `asOfDate`：`prepareTurnStart` 写入，供 `compute_age_from_hits`
- `toolResults`：`Record<key, ToolRunResult>`，Analyst 经 `pickToolResultForSubQuestion` 优先消费

### 4.3 向后兼容

- `tools/orchestrated/run-sub-question.ts` **保留**：单测与未走 graph 的直调路径仍可用
- Analyst `buildSubQuestionFallbackAnswer`：**先读 `toolResults`，再 fallback 到 orchestrated**

---

## 5. 环境变量

```bash
# .env（根目录唯一来源）
TAVILY_API_KEY=...              # 或 FAMBRAIN_TAVILY_API_KEY
FAMBRAIN_WEB_SEARCH_ENABLED=1   # 显式开启联网（无 key 仍 disabled）
```

corpus-first 不变：主路径仍先 KM；仅 `primaryDataSource=web` 或语料弱命中时 `ToolOrchestrator` 调 `search_web`。

---

## 6. 验证命令

```bash
pnpm --filter @fambrain/brain-service run verify:tool-orchestration
pnpm --filter @fambrain/brain-service run verify:dag-hybrid
pnpm --filter @fambrain/brain-service run verify:orchestrated-identity
pnpm --filter @fambrain/brain-service run verify:composite-route
pnpm --filter @fambrain/brain-service run verify:langchain-tools
```

---

## 7. 后续改进方向

| 项 | 说明 |
|----|------|
| 混合 DAG 由 LLM 生成 `executionPlan` | 当前 `buildHybridExecutionPlan` 为声明式模板，可改为 Intake JSON 输出 |
| `field-catalog` 扩展 | 工作年限差、地点等计算字段 |
| ReAct / bind-tools 实验并入主链 | 见 `experiments/bind-tools-react.ts` |
| FactChecker 对 web citations 的核查策略 | URL excerpt 与语料 path 混排 |

---

## 8. 相关文档

- [Agent 流程图 · ToolOrchestrator / DagExecutor](./02-agent-flows.md)
- [坑点 §2.5.7 identity 年龄](./04-pitfalls.md#257-identity-年龄编排工具-p0-23--2026-07)（已更新 P0-24 架构）
- [坑点 §2.5.10 列举 per-slot](./04-pitfalls.md#2510-列举执行-per-slot-架构升级-p0-26--2026-07)
- [KM 检索设计](./km-retrieval-design.md)

---

## 9. 代码布局演进（2026-07）

> **动机：** 业务 Agent 代码与应用包 `apps/brain-service` **同名**（`agentflow/brain-service/`），新人读文档、搜路径时易混淆；`ToolOrchestrator` / `DagExecutor` 在文档里是正式 Agent 角色，实现却落在 `agentflow/tool-orchestration/`，与 `intake-coordinator`、`knowledge-manager` 等 **不同级**，`compile.ts` 接线时 mental model 断裂。

### 9.1 变更对照

| 旧路径 | 新路径 | 原因 |
|--------|--------|------|
| `agentflow/brain-service/online/` | `agentflow/agents/online/` | 与应用名脱钩；`agents` = 全部 Agent 实现 |
| `agentflow/brain-service/offline/` | `agentflow/agents/offline/` | 同上 |
| `agentflow/tool-orchestration/` | `agentflow/agents/online/tool-orchestrator/` | 与 Intake / KM / Analyst **同级**；图节点实现归 online Agent |
| `agentflow/pipeline/` | **不变** | LangGraph **编排骨架**（state / routes / compile / SSE runtime） |
| `agentflow/tools/` | **不变** | LangChain **StructuredTool** 定义；包边界导出 `createFambrainTools` |
| `agentflow/utils/` | **不变** | 跨 Agent 的 LLM / Zod 小工具，非业务域 |

### 9.2 目标目录树

```
agentflow/
├── agents/
│   ├── online/          # IntakeCoordinator, KM, ToolOrchestrator, Analyst, …
│   └── offline/         # Indexer, DocParser, Learning
├── pipeline/            # graph/ + runtime/（只接线，不写业务）
├── tools/               # retrieve_corpus, search_web, …
├── utils/               # parseJsonObject, zod-utils, …
└── index.ts             # 对外 export
```

### 9.3 导入约定

跨目录引用走模块 **index** barrel，例如：

```ts
import { applyToolPlanGuard, runToolOrchestratorNode } from "@/agentflow/agents/online/tool-orchestrator";
```

详见 [`.cursor/rules/module-folder-conventions.mdc`](../.cursor/rules/module-folder-conventions.mdc)。

---

## 10. 列举执行 per-slot 演进（2026-07）

> **触发：** P0-22 列举分页上线后，穷举仍用 **整句 `routeMode=list`**；P0-26 混合问句暴露「整句只能一种执行模式」的架构上限。详见 [坑点 §2.5.10](./04-pitfalls.md#2510-列举执行-per-slot-架构升级-p0-26--2026-07)。

### 10.1 旧模型 vs 新模型

| 维度 | 旧（P0-22 初版） | 新（P0-26） |
|------|------------------|-------------|
| 穷举路由 | 整句 **`routeMode=list`** | 恒 **`routeMode=slots`**，N 槽各带 executor |
| 续问识别 | `enumeration-list-intent` **口语 regex** | Intake **`enumerationControl`** 或 UI **exact-match prompt** |
| KM 执行 | list 与 hybrid **互斥整句分支** | **`retrieval-node` 按槽**：`km_retrieve` ∥ `list_corpus` |
| 混合问 | 无法同轮 tech + 穷举 | 一槽 hybrid、一槽 list API |

### 10.2 数据流

```mermaid
flowchart LR
  IC[Intake LLM<br/>enumerationControl per plan item] --> G[applyEnumerationSlotGuard<br/>补 executor + 页码]
  G --> R[retrieval-node]
  R -->|executor=km_retrieve| KM[hybridRecall]
  R -->|executor=list_corpus| LIST[list-corpus-entries API]
  KM --> TO[ToolOrchestrator<br/>compose_enumeration]
  LIST --> TO
  TO --> IA[Analyst]
```

### 10.3 与 P0-24 工具编排的关系

- **取数**（KM / list API）在 **`retrieval-node` 按槽** 完成。
- **成稿**（blocks + 分页文案）仍由 **`ToolOrchestrator` → `compose_enumeration`** 确定性输出。
- Analyst **不**再内联列举 regex，只消费 `toolResults` + 整理后的 hits。

**验证：** `verify:enumeration-pagination`（含混合 2 槽）、`verify:enumeration-compose`。
