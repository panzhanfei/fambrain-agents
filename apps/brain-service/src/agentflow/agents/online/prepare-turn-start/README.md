# PrepareTurnStart（轮次开始）

在线 LangGraph **START 后**的轮次准备阶段（非 LLM）：

| 图节点 | SSE step | 职责 |
|--------|----------|------|
| `prepareTurnStart` | `prepare_turn_start` | ALS 记事本（token + pipeline_log） |
| `preparePipelineMemory` | `prepare_pipeline_memory` | Mem0 + LangMem 注入 |

**同问短路** 已迁至独立模块 [`../repeat-question-guard/`](../repeat-question-guard/README.md)。

---

## 目录

| 文件 | 说明 |
|------|------|
| `prepare-turn-start.ts` | `runPrepareTurnStart()` — 仅 ALS |
| `prepare-pipeline-memory-node.ts` | `runPreparePipelineMemory()` Mem0/LangMem |
| `index.ts` | 对外 barrel |

---

## 图内位置

```text
START → prepareTurnStart → repeatQuestionGuard（见 repeat-question-guard/）
                              └─ 未命中 → preparePipelineMemory → intake → …
```

与 `persist-turn-end` 对称：首段读上下文，末节点写记忆。
