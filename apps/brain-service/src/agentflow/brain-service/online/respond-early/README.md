# RespondEarly（Intake 早退）

Intake 路由后**不经 KM / Analyst** 的直接终稿节点：澄清、闲聊、短答、记忆加载失败等。

**不含同问短路**（见 [`../repeat-question-guard/`](../repeat-question-guard/README.md)）。

---

## 目录

| 路径 | 说明 |
|------|------|
| `nodes/respond-early-node.ts` | `runRespondEarlyNode()` |
| `index.ts` | 对外 barrel |

---

## 图内位置

```text
routeAfterIntake / routeAfterPrepareMemory
  → clarify | chitchat | briefReply | error → respondEarly → persistTurnEnd

contentSummarizer → respondEarly → persistTurnEnd
```

SSE step：无独立 step 名（stream 层在 respondEarly 后直接进 `persist_turn_end`）。
