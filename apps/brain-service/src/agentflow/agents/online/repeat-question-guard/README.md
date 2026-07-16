# RepeatQuestionGuard（同问短路）

同会话 **normalize 后字面相同** 的 user 问 → 复用 history 中已有 assistant 答，跳过 Mem0 / Intake / KM / FC / Analyst。

与 **检索结果缓存** 互补：同问短路按 user 原问匹配；检索 hits 缓存按 Intake 产出的 `searchQuery` 匹配。

---

## 目录

| 路径 | 说明 |
|------|------|
| `repeat-question-guard.ts` | `findRepeatAnswerInHistory()` 纯函数 |
| `nodes/repeat-question-node.ts` | `runRepeatQuestionGuard()` 图节点 |
| `nodes/repeat-respond-early-node.ts` | `runRepeatRespondEarlyNode()` 同问终态 |
| `index.ts` | 对外 barrel |

---

## 图内位置

```text
prepareTurnStart → repeatQuestionGuard
                      ├─ 命中 → repeatRespondEarly → persistTurnEnd
                      └─ 未命中 → preparePipelineMemory → intake → …
```

SSE step：`repeat_question_guard`（同问短路）、`repeat_respond_early`（复用历史答）。

开关：`REPEAT_QUESTION_CACHE_DISABLED=1` 关闭。

验证：`pnpm run verify:repeat-question-smoke`
