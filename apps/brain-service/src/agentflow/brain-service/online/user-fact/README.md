# UserFact（用户自述记忆）

跨会话 **remember / recall** 用户联系方式等结构化事实（QQ、微信、手机…），经 Mem0 持久化，**绕过 KM / FC / Analyst**。

Mem0 / LangMem 在 **`preparePipelineMemory`** 加载；本模块负责 Intake JSON 解析、图节点读写 Mem0。

---

## 目录

| 路径 | 说明 |
|------|------|
| `user-fact.ts` | `isUserFactIntent`、`routeUserFactFromIntake`、值校验、话术、Mem0 行解析 |
| `nodes/user-fact-node.ts` | `userFactNode()` LangGraph 节点（remember / recall） |
| `index.ts` | 对外 barrel |

---

## 图内位置

```text
preparePipelineMemory（加载 memoryBlock / userMemories）
  → intake（LLM intent = remember_user_fact | recall_user_fact）
  → pipeline ④ isUserFactIntent → 早退
  → routeAfterIntake → userFact 节点
       routeUserFactFromIntake(decision) → 写/读 Mem0
  → persistTurnEnd
```

SSE step：`user_fact`

验证：`pnpm run verify:user-fact`
