# PrepareTurnStart（轮次开始）

在线 LangGraph **START 后第一个节点**（非 LLM）。每轮用户消息必经此处，再进入 Intake。

**职责：**

- 创建并绑定 `pipelineRunStorage`（ALS 记事本：token + pipeline_log）
- **同问短路**（`repeat-question-guard.ts` / `findRepeatAnswerInHistory`）
- **Mem0 + LangMem** 注入（`preparePipelineMemory` → `memoryBlock` / `intakeHistory` / `userMemories`）

**命名说明：** 「同问短路」= 同会话 normalize 后字面相同的 user 问，复用 history 里的 assistant 答。**不要**与 KM 设计文档里的「L1 查询理解（Intake）」混淆。

**不做的事：** 意图识别、检索、写最终回答。

---

## 目录

| 文件 | 说明 |
|------|------|
| `prepare-turn-start.ts` | `runPrepareTurnStart()` 主流程 |
| `repeat-question-guard.ts` | 同问短路 guard |
| `index.ts` | 对外 barrel |

---

## 图内位置

```text
START → prepareTurnStart → intake → … → persistTurnEnd → END
         ↑
    routeAfterPrepare：同问命中 → respondEarly → persistTurnEnd → END
```

SSE step 名：`prepare_turn_start`（UI：准备上下文）。与 `persist-turn-end` 对称：首节点读上下文，末节点写记忆。
