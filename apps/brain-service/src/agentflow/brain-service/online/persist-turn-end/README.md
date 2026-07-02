# PersistTurnEnd（轮次结束）

在线 LangGraph **END 前最后一个节点**（非 LLM）。每轮在终稿 `answer` 就绪后执行。

**职责：**

- `persistPipelineMemory` — Mem0 轮次写入 + LangMem 会话摘要
- `persistLearningAfterTurn` — Learning 候选（`userFact` 轮次跳过）

**跳过条件：** `repeatQuestionHit`、空 `answer`。

**不做的事：** 读 Mem0、意图路由、生成回答。

---

## 目录

| 文件 | 说明 |
|------|------|
| `persist-turn-end.ts` | `runPersistTurnEnd()` 主流程 |
| `index.ts` | 对外 barrel |

---

## 图内位置

```text
… → userFact / analyst / respondEarly → persistTurnEnd → END
```

与 `prepare-turn-start` 对称：首节点读上下文，末节点写记忆。

SSE step 名：`persist_turn_end`（UI：写入记忆）。
