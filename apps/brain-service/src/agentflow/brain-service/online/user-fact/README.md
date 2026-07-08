# UserFact（用户自述记忆）

跨会话 **remember / recall** 用户联系方式等结构化事实（QQ、微信、手机…），经 Mem0 持久化，**绕过 KM / FC / Analyst**。

Intake 通过 `routeUserFactFromIntake` 解析 JSON → `guards/intake-user-fact-guard` 包装进 `decision.userFact` → 图节点 `userFactNode` 读写 Mem0。

---

## 目录

| 路径 | 说明 |
|------|------|
| `user-fact.ts` | 路由解析、值校验、话术、Mem0 行解析 |
| `nodes/user-fact-node.ts` | `userFactNode()` LangGraph 节点 |
| `index.ts` | 对外 barrel |

Intake 侧 guard 仍在 [`../intake-coordinator/guards/intake-user-fact-guard.ts`](../intake-coordinator/guards/intake-user-fact-guard.ts)。

---

## 图内位置

```text
intake → routeAfterIntake（decision.userFact）→ userFact → persistTurnEnd
```

SSE step：`user_fact`（读取记忆）。

验证：`pnpm run verify:user-fact`
