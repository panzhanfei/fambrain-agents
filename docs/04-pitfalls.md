# Agent 开发坑点清单

[← 返回 README](../README.md) · [流程图](./02-agent-flows.md) · [路线图](./03-roadmap.md)

**跟踪方式：** 通用坑落实对策后，把 `- [ ]` 改成 `- [x]`；本项目踩坑表更新 **状态** 列。

---

## 一、行业常见坑（19 项）

### 推理与规划（4）

- [ ] **#1 意图误判** — **触发：** 入口接线员把「帮我总结一下」误判为检索，实际是要对已检索结果做分析 — **对策：** 入口接线员输出结构化意图标签，信息分析师二次确认
- [ ] **#2 任务拆分不合理** — **触发：** 复杂问题只分给一个 Agent，简单问题却拆给三个 — **对策：** 入口接线员维护拆分规则，简单问题直通，复杂问题并行分发
- [ ] **#3 过早终止** — **触发：** 信息分析师只检索一次就回答，信息不足但强行输出 — **对策：** 加信息充分性检查节点，不足时触发补充检索
- [ ] **#4 计划漂移** — **触发：** 多步推理中第一步偏了，后续全部跑偏 — **对策：** 事实核查员中途介入，验证中间结果再放行

### 工具调用（4）

- [ ] **#5 工具选择错误** — **触发：** 该查向量库却去调文件解析 — **对策：** 工具描述精确化，参数 Schema 校验，错误日志统计
- [ ] **#6 工具调用死循环** — **触发：** 检索失败 → 重试 → 又失败 → 无限重试 — **对策：** 最大重试 3 次，超限降级用缓存或返回「暂时无法检索」
- [ ] **#7 工具返回不可解析** — **触发：** API 返回 HTML 而非 JSON，Agent 无法理解 — **对策：** 输出解析器 + 正则兜底，标准化错误消息
- [ ] **#8 参数传递错误** — **触发：** Agent 传了字符串但工具要数字，或 JSON 层级不对 — **对策：** 参数类型校验层，自动类型转换，失败时返回明确错误提示

### 幻觉与事实性（3）

- [ ] **#9 信息捏造** — **触发：** 信息分析师编造不存在的文档引用 — **对策：** 事实核查员用向量库反向验证，未找到来源就打回
- [ ] **#10 断章取义** — **触发：** 检索片段与原文限定条件不一致 — **对策：** 回答时标注原文引用，事实核查员对比一致性
- [ ] **#11 过度自信** — **触发：** 信息分析师用肯定语气输出错误估算 — **对策：** 不确定时标注「估算，建议核实」；可信度低于 0.7 时降低语气

### 多 Agent 协作（4）

- [ ] **#12 重复输出** — **触发：** 知识管理员和文档处理师都返回同一份文档内容 — **对策：** 内容整理师去重，按来源合并
- [ ] **#13 协商死循环** — **触发：** 事实核查员打回 → 分析师修正 → 又被同一问题打回 — **对策：** 最多 2 轮修正，协调官强制终止并标记「存疑」
- [ ] **#14 发言顺序混乱** — **触发：** 两个 Agent 同时推送消息，顺序不确定 — **对策：** 入口接线员通过优先级队列 + 回合令牌控制发言顺序
- [ ] **#15 信息不对称** — **触发：** 分析师看到旧索引，文档刚更新 — **对策：** 统一数据快照，每次任务前刷新索引状态

### 记忆与上下文（3）

- [ ] **#16 关键信息遗忘** — **触发：** 用户第 1 轮说「我是前端开发」，第 5 轮却推荐后端框架 — **对策：** 用户偏好写入共享状态，每轮对话前注入偏好摘要
- [ ] **#17 上下文污染** — **触发：** 中间错误步骤留在上下文中，影响后续决策 — **对策：** 上下文分层管理，错误步骤清除，只保留修正后的结果
- [ ] **#19 跨轮重复检索** — **触发：** 用户在同一会话再次发送相同或极相似问题（如连续两遍「城管平台用了什么技术？」），系统仍全量走 Intake → KM → FactChecker → Analyst，体感「又核查、又检索」 — **对策：** 不依赖 FactChecker 跨轮记忆；采用 **检索结果缓存**（`corpusUserId + searchQuery`，TTL）+ **Intake 识别重复问**（复用上轮 grounded 回答或 `direct_answer`）；同义改写走 semantic cache；详见 §2.2

### 流式输出与可观测性（1）

- [x] **#18 推理黑盒（P0 部分）** — **已做：** SSE `step` 展示 intake / retrieval / **fact_checker** / **`content_organizer`** / analyst；`thinking` 展示推理流；`agent-log` 打 Intake / KM / **FactChecker** / **ContentOrganizer** / Pipeline — **待做：** Token 统计、引用列表 UI、完整调试面板（P1）

---

## 二、本项目踩坑（FamBrain P0 + D3 联调）

> P0 条目来自 **2026-05 初版联调**；**§2.1** 来自 **2026-05-22**（LangChain 向量检索接入 + Golden 回归）。对策以 **prompt + 编排兜底 + 集中消坑 sprint** 为主。

### Agent 职责边界（合同）

| Agent | 只负责 | 禁止 |
|--------|--------|------|
| IntakeCoordinator | `intent`、`searchQuery`、`topics`、`subTasks` | 写长答案、编造履历、决定「下一个 Agent 名字」 |
| KnowledgeManager | 从 **candidates** 选 `hits`（path / excerpt / relevance） | 对用户说话、归纳终稿、编造未出现在候选中的事实 |
| FactChecker | 审当轮 `hits`/`coverage`；产出 `passed`、`refinedSearchQuery`、`checkerNotes` | 写用户终稿、编造 hits、跨轮缓存「已验过」 |
| ContentOrganizer | 规范化 / 去重 `hits`；空 hits 时 `coverage=none` | 调 LLM、写终稿、跨轮改 searchQuery |
| InformationAnalyst | 据 `hits` 写 `answer` + `citations`；无据时 `insufficientEvidence` | 无 `hits` 时按训练数据编造经历 |

### P0 踩坑表

| ID | 环节 | 现象 | 根因 | 对策（Agent 向） | 状态 |
|----|------|------|------|------------------|------|
| P0-1 | Intake | 「我的名字」→ `clarify` | 小模型过度套用澄清示例 | prompt 收紧 clarify + 姓名→检索示例 | ✅ 已缓解 |
| P0-2 | Intake | `confidence` 高但路由错 | 模型过度自信 | 代码规则 + `defaultIntakeDecision` | ✅ 已缓解 |
| P0-3 | KM | 预扫有候选，最终 `hits:[]` | P0 关键词路径：token 不一致；中文匹配 | 统一 token；二元切分；`coalesceRetrieval` | ✅ P0 已缓解 |
| P0-4 | KM | LLM 精排整批不选 | prompt 鼓励空数组 | candidates 非空时至少 1 hit；代码回退 | 🔄 D3 仍频发 |
| P0-5 | 编排 | 以为模型指定下游 Agent | 误解职责 | 路由表在 `pipeline/graph/compile.ts` | ✅ 已解决 |
| P0-6 | Analyst | 有 hits 仍说未检索到 | `hits` 未传入或上游已空 | 对齐 `agent-log` 链与 `analystInput.hits` | ⬜ 待回归 |
| P0-7 | Prompt | few-shot 带偏 | 示例与口语问法不一致 | 补正向示例；负例写清边界 | 🔄 进行中 |
| P0-8 | 多 Agent | Intake/KM/Analyst 串台 | 单 prompt 包打天下 | 严守合同；终稿只在 Analyst | 🔄 持续 |
| P0-9 | RAG | 口语命中率低 | 曾仅关键词；离线向量已入库 | Intake 补全指代；在线向量检索 | ✅ D3 已接 LangChain |
| P0-10 | 上下文 | `corpusUserId` 与「我是谁」混淆 | 语料主人 ≠ 登录者 | session / direct_answer 与 corpus 分离 | ⬜ 待做 |
| P0-11 | FactChecker / 编排 | 用户以为「核查过一次，同句再问不应再进 FactChecker」 | **两类现象混为一谈：**（A）同轮打回再检索 → FactChecker 跑 2 次是 Corrective RAG 设计；（B）**新一条用户消息** = 新 pipeline，`checkerPassed`/`retryCount` 重置，无跨轮 cache | 见 §2.2；消坑 sprint **D5-消坑** | ⬜ 待做 |

### 2.2 FactChecker 与跨轮重复检索（2026-06 · D5 联调）

> **背景：** D5 已接入 `Intake → KM → FactChecker → Analyst`。FactChecker 职责是 **检索后、生成前** 审查当轮 `hits`/`coverage`，不是「验完永久放行」；市面同类为 Self-RAG / Corrective RAG 的 **evidence grader**，跨轮去重靠 **cache / Intake**，不靠 FactChecker 记状态。

#### 何时会进入 FactChecker（代码：`pipeline/graph/compile.ts`）

| 条件 | 路径 |
|------|------|
| `needsRetrieval === true` | `retrieval` → **必进** `factChecker` → `analyst` 或打回再 `retrieval` |
| 闲聊 / clarify / `briefReply` 提前结束 | **不进**（`respondEarly`） |
| `needsRetrieval === false` 且无 `briefReply` | 少见：直接 `factChecker`（通常 `passed=true`） |

**同轮第二次 FactChecker：** 仅当第一次 `passed=false` 且 `retryCount < 1` → 改写 `searchQuery` 再检索 → **必须再审新一轮 hits**（不是 bug）。

**新一轮用户消息（即使用户字面上重复上一问）：** 整图重跑；`history` 只帮 Intake 理解指代，**不会**跳过 KM / FactChecker。

#### 典型误解 vs 实际

| 误解 | 实际 |
|------|------|
| 第一次 FactChecker 后问题应被「解决」 | 同轮只决定**本轮**证据够不够；打回 = 再检索，不是写入会话记忆 |
| 同句再问应跳过核查 | P0 无 query cache / 重复问识别 → 每轮检索类问题仍会核查 |
| FactChecker 应避免重复读原文 | 审的是**当轮** `hits`；跨轮重复靠 cache，不靠 FactChecker |

#### 推荐对策组合（后续集中实现 · 优先级）

| 优先级 | 对策 | 解决哪类「第二次」 | 改动面 |
|--------|------|-------------------|--------|
| P0 必留 | 检索后 FactChecker + 最多 1 次打回再检索 | 同轮证据不足 | 已实现 |
| **+1** | **检索结果缓存** `corpusUserId + normalizedSearchQuery`，TTL 5～30min；cache hit 时 FactChecker 规则快检或跳过 LLM | 跨轮同句/同义再问 | `retrieveKnowledge` / `retrievalNode` |
| **+2** | **Intake 重复问识别**：归一化后与本会话上一轮 user 相同 + 上轮为检索回答 → `needsRetrieval: false`，Analyst 复用 history 简答（附「与上次一致」） | 跨轮 verbatim 重复 | `intake-coordinator` prompt + `routeAfterIntake` |
| +3 | 生成后 citation 规则校验（answer vs hits） | 幻觉终稿 | Analyst 后节点 / pitfalls #9 |
| +4 | 向量 rerank，降低 FactChecker 打回率 | 同轮少出现 2 次 FactChecker | KM |

**不建议：** 仅靠 FactChecker 跨轮记住 `passed` 跳过（语料更新、上下文变化会导致陈旧或漏检索）。

#### 踩坑表

| ID | 环节 | 现象 | 根因 | 对策（计划） | 状态 |
|----|------|------|------|--------------|------|
| D5-1 | FactChecker | 证据无命中时 UI 出现两次「核查证据…」+ 两次检索 | `routeAfterFactChecker` 打回逻辑 | 保留；用 D3-2 提高首轮命中率，减少打回 | 🔄 预期行为 |
| D5-2 | 编排 / UX | 聊天记录里**同一句再问**，仍走检索+核查 | 每轮 `runPipelineStream` 状态重置；无 cache | 检索 cache + Intake 重复问（§2.2 表） | ⬜ **消坑 sprint D5-消坑** |
| D5-3 | 职责 | 期望 FactChecker 校验**终稿** vs hits | P0 仅在生成前审证据包 | D6 后或 +3 增加生成后 groundedness | ⬜ 路线图 |
| D5-4 | SSE | 重复问时 step 闪过快，用户只注意到「整理回答」 | `fact_checker` 与 `analyst` 连续 | 可选：重复问跳过 fact_checker step 展示 | ⬜ 低优 |

**验证脚本：** `pnpm run verify:fact-checker`、`pnpm run verify:fact-checker:pipeline`（`apps/agents/package.json`）。

### 2.1 D3 / LangChain 联调踩坑（2026-05-22）

> **背景：** 入库 + 在线检索由 LlamaIndex 迁至 **LangChain**（`@langchain/community` Chroma + `@langchain/ollama` Embeddings）；向量预扫已通，Golden G4 仍偶发 `hits:[]`。

| ID | 环节 | 现象 | 根因 | 对策（计划） | 状态 |
|----|------|------|------|--------------|------|
| D3-1 | 架构 | 入库 LlamaIndex、检索 LangChain 双栈 | 历史选型 + 渐进迁移 | 已统一 LangChain；`knowledge/chroma-rag.ts` 共享配置 | ✅ 已解决 |
| D3-2 | KM | **`candidateCount:12` 但 `hits:[]`**（P0-3 复发） | 向量语义召回 OK；LLM 精排空；关键词 fallback 按字面 token，与向量候选不匹配；`coalesceRetrieval` 两路皆空 | **向量顺序 fallback**：candidates 非空时禁止最终 hits 为空；保留 score | ⬜ **消坑 sprint D1** |
| D3-3 | KM | 日志常见 `notes: 仅关键词匹配…` | LLM 精排 JSON 不稳定或未产出有效 hits | 精排 Zod 化；失败即向量 fallback，不依赖关键词 | ⬜ sprint D1 |
| D3-4 | KM | Intake 扩写含 `urban-governance` / `tech-stack` 等英文 tag | topics 拼进 tokenize，中文语料无字面命中 | topics 仅作向量 query；fallback 不用英文 tag；或向量 fallback 绕过 tokenize | ⬜ sprint D1 |
| D3-5 | KM | 向量 `score` 在 `loadCandidates` 后丢失 | candidate 类型只有 path/title/body | 扩展 candidate 带 `score`；fallback 按 score 排序 | ⬜ sprint D1 |
| D3-6 | KM | 12 条候选里同一 md 出现 3+ 次 | `topK=12` 按 chunk 检索，未按 `path` 去重 | 常量集中配置；召回后 path 去重（每文件 ≤2 chunk） | ⬜ sprint D2 |
| D3-7 | 配置 | `12` / `5` / `40` 分散硬编码 | P0  magic number | `VECTOR_TOP_K` / `MAX_HITS` / `INTAKE_HISTORY_TURNS` 收一处或 `.env` | ⬜ sprint D2 |
| D3-8 | Intake | 仅 `history.slice(-40)` 有上下文 | 控 Ollama context；Web 传全量 DB 历史 | 40 可配置；pipeline 注入「上一轮检索主题」摘要 | ⬜ sprint D3 |
| D3-9 | Analyst | 追问「那个项目呢」易 clarify 或答偏 | Analyst **不读**全量 DB 历史，仅 `userQuestion` + hits + **memoryBlock** | 传最近 2～4 轮；D8 已注入 Mem0/LangMem，Golden 待验证 | 🔄 sprint D3 |
| D3-10 | RAG | G3「项目+技术」hits 有但偏 `aky-*` 模板 | 向量未优先 `experience/` / `personal/` | 路径加权或 Intake topics 引导；Golden G3 断言 path 分布 | ⬜ sprint D2 |
| D3-11 | 文档 | 流程图/roadmap 仍写 LlamaIndex retriever、D3 未接 | 迁移后未同步 docs | 与代码对齐 LangChain；更新 A2 验收状态 | ⬜ sprint D4 |
| D3-12 | 开发 | `pnpm dev` agents `EADDRINUSE :3001` | 旧进程占端口 | 文档写「先 kill 3001」；或 dev 脚本检测复用 | ⬜ sprint D4 |

**典型日志（D3-2）：**

```text
[KnowledgeManager] 预扫候选 candidateCount: 12, paths: [..., aky-qh-mucktruck-console.md, ...]
[KnowledgeManager] 检索结果 { hits: [], coverage: "none", notes: null }
```

**链路说明（通俗）：** 向量「书架找书」成功 → LLM「管理员挑书」失手 → 关键词「按书名搜字」也对不上 → 最终交空列表给 Analyst。

### 与通用坑 #1～#19 的对应

| 本项目 | 通用坑 |
|--------|--------|
| P0-1 | #1 意图误判 |
| P0-3 / D3-2 | #5 / #7 工具输出不可信 |
| P0-4 / D3-3 | #7 工具返回不可解析 |
| D3-6 / D3-10 | #12 重复输出（同 path 多 chunk） |
| P0-9 / D3-2 | 检索策略限制 |
| D3-8 / D3-9 | #16 关键信息遗忘 |
| P0-10 | #15 信息不对称 |
| P0-11 / D5-2 | #19 跨轮重复检索 |
| D5-1 | #6 工具调用死循环（已限 1 次打回，非死循环） |

---

## 三、集中消坑计划（核心 Agent 完成后 · 4 天）

> **前置：** 四个 Agent 骨架接入主链路 — `FactChecker`（D5）、`ContentOrganizer`（D6）、`DocParser`（D7 触达）、`ContentSummarizer`（D9 触达）。完成后 **核心对话 Agent 算齐**，再专心清坑 + 回归。

| 天 | 焦点 | 目标坑 ID | 交付 |
|----|------|-----------|------|
| **消坑 D1** | KM 检索闭环 | D3-2～D3-5 | 向量 fallback；candidates 非空 → hits 必非空；Golden G4 稳定 |
| **消坑 D2** | 召回质量 | D3-6～D3-7、D3-10 | path 去重；常量集中；G3 path 分布改善 |
| **消坑 D3** | 多轮上下文 | D3-8～D3-9、P0-10 | Intake/Analyst 短历史；pipeline 检索摘要 |
| **消坑 D4** | 回归 + 文档 | D3-11～D3-12、P0-6、A6 | G1～G5 全自动脚本；docs/流程图/sync；FactChecker 与 KM 联调 |
| **消坑 D5-消坑** | 跨轮少重复 | D5-2、P0-11；可选 D5-4 | 检索 cache；Intake 同句重复问；Golden：连续两问 G4 第二次命中 cache 或简答 |

**完成标准（核心 Agent + 消坑）：**

- [x] 在线链路（P0）：Intake → KM（向量 + 关键词）→ **FactChecker** → **ContentOrganizer** → Analyst
- [ ] Golden **G1～G5 ≥4 条稳定通过**（允许 G5 clarify 行为一致即可）
- [ ] D3-2 **不可复现**（12 candidates → hits 必 ≥1）
- [ ] 踩坑表 D3-* 与 P0-4 / P0-6 状态更新为 ✅ 或 🔄 有明确遗留
- [ ] D5-2：同会话连续两问 G4 原文，第二次不再全量向量检索（cache 或 Intake 复用）← §2.2

---

## 四、调试 checklist（每轮对话 · P0 + D3 + D5）

- [ ] 若出现**两次** `fact_checker` step：查 FactChecker 第一次是否 `passed=false`、是否打回再检索（D5-1，常伴 `retryCount: 1`）← §2.2
- [ ] 若**新一条消息**与上轮同句仍全链路：属 D5-2 未消坑，非 FactChecker 失效

- [ ] Intake 原始 JSON 是否合理（`intent` / `searchQuery` / `needsRetrieval`）
- [ ] KM 预扫 `paths` 是否有内容；**`hits` 是否非空（若 `candidateCount > 0`）** ← D3-2
- [ ] KM `notes` 是否长期为「仅关键词匹配」（若是，精排或 fallback 需优化）← D3-3
- [ ] 预扫 paths 是否同一 md 重复过多（chunk 去重）← D3-6
- [ ] Analyst 输入里 `hits` / `coverage` 是否与 KM 一致 ← P0-6
- [ ] 终稿是否出现候选中不存在的公司、项目、日期（幻觉）
- [ ] 换模型复现：区分 prompt 问题 vs 模型能力（`OLLAMA_MODEL` / `OLLAMA_MODEL_INTAKE_COORDINATOR`）
- [ ] agents 服务 `:3001` 是否唯一实例（无 EADDRINUSE）← D3-12
- [ ] FactChecker 日志：`passed` / `refinedSearchQuery` / `retryCount` 是否符合 §2.2 判定表
