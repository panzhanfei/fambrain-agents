# CorpusLister（语料目录列举）

纯 **list_corpus** 路径：按 `projects/`、`experience/` 目录扫盘分页，**不经 KM hybrid**。

## 图节点

| 节点 | 文件 | 何时进入 |
|------|------|----------|
| `listRetriever` | `nodes/list-retriever-node.ts` | Intake 后 `isPureListDecision`：全部槽 `executor=list_corpus`，且无 km/tool/dag |

**短路径：** `intake → listRetriever → contentOrganizer → analyst → persistTurnEnd`（跳过 planExecutor / FC / tool）。

**复合问**（km + list 混搭）仍走 `planExecutor → runRetrievalNode`，list 槽经 `fetchListSlot` 复用本模块。

## 目录

```text
corpus-lister/
├── index.ts
├── fetch-list-slot.ts      # 单槽 list 检索（listRetriever + composite 共用）
├── pure-list-route.ts      # isPureListDecision
├── list/
│   ├── list-corpus-entries.ts
│   ├── retrieve-enumeration-page.ts
│   └── entry-time-window.ts
└── nodes/
    └── list-retriever-node.ts
```

## 与 KnowledgeManager 边界

| | CorpusLister | KnowledgeManager |
|---|---|---|
| 触发 | exhaustive / continue / UI 分页 | identity / tech / preview 列举 / 复合 km 槽 |
| 机制 | path 排序 + slice | hybrid（vector ∥ sparse）+ rank + confidence |
| 图节点 | `listRetriever` | planExecutor 内 `runRetrievalNode` |

HTTP：`POST /enumeration/list`（`server/enumeration-list.ts`）同样走本模块 `listCorpusEntriesPage`。
