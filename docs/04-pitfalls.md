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
| P0-3 | KM | 预扫有候选，最终 `hits:[]` | P0 关键词路径：token 不一致；中文匹配 | 统一 token；二元切分；`ensureNonEmptyHits` | ✅ 已缓解（2026-06 规则精排） |
| P0-4 | KM | LLM 精排整批不选 / 改写 excerpt、编造 notes | 小模型精排不稳定；prompt 鼓励空数组 | **移除 KM 在线 LLM**；向量高置信 → 规则输出；低置信 → 关键词扫盘 + 规则；candidates 非空至少 1 hit | ✅ **已解决**（2026-06） |
| P0-5 | 编排 | 以为模型指定下游 Agent | 误解职责 | 路由表在 `pipeline/graph/compile.ts` | ✅ 已解决 |
| P0-6 | Analyst | 有 hits 仍说未检索到 | `hits` 未传入或上游已空 | 对齐 `agent-log` 链与 `analystInput.hits` | ⬜ 待回归 |
| P0-7 | Prompt | few-shot 带偏 | 示例与口语问法不一致 | 补正向示例；负例写清边界 | 🔄 进行中 |
| P0-8 | 多 Agent | Intake/KM/Analyst 串台 | 单 prompt 包打天下 | 严守合同；终稿只在 Analyst | 🔄 持续 |
| P0-9 | RAG | 口语命中率低 | 曾仅关键词；离线向量已入库 | Intake 补全指代；在线向量检索 | ✅ D3 已接 LangChain |
| P0-10 | 上下文 | `corpusUserId` 与「我是谁」混淆 | 语料主人 ≠ 登录者 | session / direct_answer 与 corpus 分离 | ⬜ 待做 |
| P0-11 | FactChecker / 编排 | 用户以为「核查过一次，同句再问不应再进 FactChecker」 | **两类现象混为一谈：**（A）同轮打回再检索 → FactChecker 跑 2 次是 Corrective RAG 设计；（B）**新一条用户消息** = 新 pipeline，`checkerPassed`/`retryCount` 重置，无跨轮 cache | 见 §2.2；消坑 sprint **D5-消坑** | ⬜ 待做 |
| P0-12 | Analyst + FC | **路径 B（待验证）：** FC **二次 force_pass**（`retryCount≥1`）后 KM 仍 `hits=[]` / `coverage=none`，Analyst **仍调 LLM** 编造终稿（如陈明 / Charlie；语料实际为潘展飞） | `streamAnalyzeInformation` hits 空仍调 LLM；`buildFallbackAnswer` 仅在 JSON 解析失败时用；FC `checkerNotes` 未在 Analyst 层 enforce。**与 P0-17 不同：** P0-17 是 KM₁ 曾有 hits，被 FC 打回后 KM₂ 变差 | hits 空时 **跳过 LLM** 直出 fallback（仍经 Analyst 节点或 `respondEarly`，不编造）；normalize 强制 `insufficientEvidence`；**先复现再改**（§2.2.1） | ⬜ **待复现验证**（§2.2.1） |
| P0-17 | FactChecker + 编排 | **路径 A：** KM₁ 有 hits，FC 产出 meta 式 `refinedSearchQuery`（如「姓名 **全名 完整称呼**」），编排覆盖 `searchQuery` → KM₂ 变差 | FC LLM 把「怎么查」写成检索词；编排无条件覆盖；无 refined 有效性校验 | `personal/` + 姓名类 → **跳过 FC LLM 直接 pass**；`mergeRetrySearchQuery` meta  strip + 无增量不重检；见 **§2.2.2** | ✅ **已解决**（2026-06） |
| P0-13 | Intake | Golden / Web「你好」→ `briefReply` 出现 **「大表哥」** 等未定义称呼；prompt 示例为「FamBrain 助手」 | `chitchat` 路径不经 Analyst；Intake 小模型在 `briefReply` 自由发挥 | prompt 禁止称呼用户昵称；`briefReply` 规则化或模板兜底；可选 Zod 后检 | ⬜ Golden Day 2（§2.5） |
| P0-14 | Analyst + Mem0 | 「我的名字」→ 同句 **「知识库没有记录」+「长期记忆已知潘展飞」** 自相矛盾 | hits 弱时走 insufficientEvidence 话术，Mem0 又补姓名；**corpus 与 memory 优先级未定义** | 个人信息类：**hits 含 personal 优先**；Mem0 仅辅助指代、不得与 corpus 结论冲突；hits 空时不应用 Mem0 补履历事实 | ⬜ Golden Day 2（§2.5） |
| P0-15 | Analyst | 同问「**我叫什么 年龄 职业 从业经历**」→ 一次答 **赵一 / 28 岁 / 秦汉新城智慧园林**（语料无此人），一次答 **潘展飞** + 简历引用（正确） | KM hits 波动 + Analyst 在 weak hits 下用训练数据填「完整简历模板」；复合问法未拆 subTasks | Intake 拆 subTasks；KM 强制命中 `personal/个人简历*`；Analyst 禁止输出 hits 外姓名/公司；**D5-3** 终稿校验 | ⬜ Golden Day 2（§2.5） |
| P0-16 | Mem0 / Analyst | **对话 A** 用户说「记住我的 QQ 是 xxx」并确认；**新建对话 B** 问「我的 QQ 是多少？」→ 答不知道 / 语料无记录 | LangMem 仅本会话；Mem0 轮次后 `add` 可能未抽出 QQ、语义 search 未命中、或 Analyst 走 corpus 检索且 hits 空时未用 Mem0；`persistPipelineMemory` 失败被 `.catch` 吞掉 | Intake 识别 **remember_fact** → 显式 Mem0 写入；联系方式类 query **Mem0 优先**；持久化失败打日志/告警；Golden **G-跨会话记忆**（A 记 → B 问） | ⬜ Web 联调（§2.6） |
| R6-1 | KM / Analyst | **「我在那几家公司上过班？」** 应枚举 **4 家**，首轮只答 **2 家**（西安奥卡云、苏州奖多多）；**同句再问** 仅确认 **1 家** 并称其余「知识库无记录」 | 见 §2.3 | 枚举型 query 专用召回 + Golden；复盘后消坑 sprint | ⬜ **复盘后统一解决** |
| R6-2 | Analyst / 上下文 | **同会话追问**（如「用表格列出来 时间 职位 公司名称」）：上一轮已确认 **西安奥卡云**，本轮却称「没有明确列出具体公司」 | 见 §2.4 | 追问继承上轮 grounded 结论 + Intake 识别表格/格式化 follow-up；与 R6-1 一并消坑 | ⬜ **复盘后统一解决** |

### 2.3 工作经历枚举不完整 / 同问不同答（2026-06 · 复盘前记录）

> **背景：** 会话「测试 langchain&langgraph」中用户问「我在那几家公司上过班？」（语料实际应有 **4 段公司经历**）。首轮回答列出 2 家并带起止时间；用户**原句再问**后仅确认 1 家（西安奥卡云），其余称知识库无对应记录——**同一问题、同一会话，结论不一致且均少于 4 家**。

#### 现象摘要

| 轮次 | 用户问 | 实际回答 | 与预期 |
|------|--------|----------|--------|
| 首轮 | 我在那几家公司上过班？ | 西安奥卡云、苏州奖多多（2 家 + 日期） | 缺 2 家 |
| 再问（同句） | 我在那几家公司上过班？ | 仅西安奥卡云；其余「未在知识库找到」 | 缺 3 家；与首轮不一致 |

#### 根因分析（待复盘验证）

| 层级 | 根因 | 说明 |
|------|------|------|
| **问题类型不匹配** | KM 按「最相关 **5 条片段**」设计，非「穷举全部雇主」 | `MAX_HITS=5`、`MAX_CANDIDATES=12`；向量 topK 按 chunk 相似度，**列举型问题**易只拉回 1～2 个经历 chunk，其余公司文档进不了 candidates |
| **精排 / 合并** | ~~LLM 精排~~ → **规则 excerpt** | 2026-06 起 KM 不再调 Chat LLM；`pickExcerpt` 按 token 对齐 chunk 原文；同一 path 多 chunk 仍可能只交一条 excerpt |
| **跨轮不一致** | 每轮新 pipeline 全量重跑（§2.2 D5-2） | 同句再问时 Intake 的 `searchQuery` / `topics` 可能略变；向量召回有波动；KM 现为确定性规则路径（`resultSource: "rule"`）→ **hits 数量波动应下降**，但 chunk 边界问题仍在 |
| **Analyst 保守** | `coverage=partial` 时禁止推断未出现在 hits 中的履历 | hits 不全时 Analyst 正确表现为「只确认知识库有的」——**上游漏召回会被当成「库里没有」** |
| **语料 / 索引** | 4 家可能分布在 `experience/` 多文件，未全部入 Chroma 或关键词未命中 | 需核对 `data/doc/users/<corpusUserId>/corpus/experience/` 文件数与 `index-all-corpus` 日志；与 D3-6（同 path 多 chunk）、D3-10（向量偏 projects 模板）叠加 |

**链路（通俗）：** 用户要「完整名单」→ 检索按「最像的几段」找书 → 管理员最多交 5 张摘抄 → 分析师只能念摘抄上的公司 → 再问一遍又重新找书，摘抄张数还不稳定。

#### 对策（计划 · 复盘后纳入消坑 sprint）

| 优先级 | 对策 | 改动面 |
|--------|------|--------|
| P0 | Intake 识别 **list_enumeration**（「哪几家」「全部公司」）→ `subTasks` 标明穷举；KM 对该类 query **提高 topK / 按 path 聚合后再枚举** | `intake-coordinator`、`retrieve.ts` |
| P0 | candidates 含 `experience/` 多 path 时，**禁止 LLM 合并成单 hit**；或走 **无 LLM 的规则枚举**（从 experience 标题/公司行解析） | `prompt.ts`、`retrieve.ts` |
| +1 | Golden **G-工作经历**：断言 4 家公司名均出现在 hits 或 answer | `scripts/experiments` / Golden |
| +1 | 同句再问：§2.2 检索 cache，减少 hits 波动 | D5-消坑 |
| +2 | experience 专索引引或路径加权（与 D3-10 合并） | `corpus-vector`、`intake` topics |

**验证：** 同会话连续两问「我在那几家公司上过班？」→ 两次 answer 公司集合一致且 **= 4**；`agent-log` 中 KM `hits` path 覆盖全部经历文件。

### 2.4 同会话追问自相矛盾（2026-06 · 联调截图）

> **背景：** 会话中用户先问工作经历相关问题时，助手**已确认**「你曾在西安奥卡云公司工作」；用户**紧接着**追问「我在那几家公司上过班？用表格给我列出来 时间 职位 公司名称」，助手却回答「当前没有明确列出你具体工作的公司及其对应的时间和职位信息」——**与上一轮结论直接矛盾**，连已确认的公司也「消失」了。

#### 现象摘要

| 轮次 | 用户问 | 实际回答 | 与预期 |
|------|--------|----------|--------|
| 首轮 | （工作经历类问题，具体措辞因会话而异） | 可确认 **西安奥卡云**；其余时间/公司「未在知识库找到」 | 至少应保留已确认项 |
| 追问 | 我在那几家公司上过班？**用表格列** 时间 / 职位 / 公司 | 「**没有明确列出**具体公司…时间及职位」；建议用户提供公司名 | **否定**上轮已给出的西安奥卡云；表格为空 |

#### 与 R6-1 的区别

| | R6-1（§2.3） | R6-2（本节） |
|--|--------------|--------------|
| 触发 | **同句**再问「我在那几家公司上过班？」 | **换说法追问**（加「表格」「时间 职位 公司」） |
| 主要问题 | 枚举不完整 + hits 数量波动 | **跨轮失忆**：上轮 grounded 结论未带入本轮 |
| 用户体感 | 「怎么少了几家？」 | 「你刚才还说有，怎么现在说没有了？」 |

#### 根因分析（待复盘验证）

| 层级 | 根因 | 说明 |
|------|------|------|
| **Intake** | 追问被当成**全新检索题**，未识别为「基于上轮 answer 的格式化 / 补全」 | `searchQuery` 重写后走全量 KM → 新 hits 可能更空；未标记 `follow_up_format` / `reuse_prior_grounded` |
| **Analyst 上下文** | Analyst 主要读 `userQuestion` + **当轮** `hits`，**不读**会话内上一轮 assistant 的 grounded 回答（§2.1 D3-9） | 当轮 hits 不足时，Analyst 按合同输出「无明确记录」，**覆盖** history 里已有结论 |
| **检索波动** | 与 R6-1 叠加：表格类追问仍触发向量 + 精排，hits 可能比首轮更少 | 上游漏召回 → Analyst 保守表述被用户读成「全盘否认」 |
| **输出形态** | 用户要表格，pipeline 无「结构化输出」节点 | Analyst 在 `insufficientEvidence` 路径下给 prose 澄清，未尝试用已有片段填部分行 |

**链路（通俗）：** 第一轮找到了一张摘抄（西安奥卡云）→ 用户要整理成表 → 系统当作新问题重新找书 → 这次摘抄更少或为空 → 分析师说「库里没写清楚」→ **用户以为上一轮也是错的**。

#### 对策（计划 · 与 R6-1 一并纳入消坑 R6）

| 优先级 | 对策 | 改动面 |
|--------|------|--------|
| P0 | Intake 识别 **follow-up on prior retrieval**（含「表格 / 列出来 / 刚才 / 补充」+ 同主题）→ `needsRetrieval: false` 或 **合并**上轮 hits + 本轮增量检索 | `intake-coordinator` prompt、`routeAfterIntake` |
| P0 | Analyst 注入 **上一轮 grounded answer 摘要**（或 citation 列表）；当轮 hits 为空时**不得否定** history 中已标注「知识库确认」的事实 | `information-analyst`、`pipeline` state |
| +1 | Golden **G-工作经历-追问表格**：首轮至少 1 家 → 追问表格 answer **仍含**该公司且不为「无记录」 | `scripts/experiments` |
| +1 | 表格类输出：Analyst prompt 允许「部分填表 + 缺项标注未知」，而非整表拒答 | `information-analyst` prompt |

**验证：** 同会话：先得到含「西安奥卡云」的 grounded 回答 → 再问「用表格列时间职位公司」→ answer **至少保留**西安奥卡云一行；不得出现「没有明确列出具体公司」类全盘否定表述。

### 2.5 Golden Day 2 联调实录 — 问题记录与解决顺序（2026-06）

> **原则：** Golden **用来发现问题**；**坑点表用来记录与排期**；改代码消坑后再用 Golden 验收。**不是**「多加几条断言就算完成」。
>
> **工作流：** 跑 Golden / Web → 现象记入本节 + P0 表 → 对照根因选 sprint 对策 → 改代码 → 再跑 Golden（`GOLDEN_RUNS=3` 看稳定性）→ 坑位标 ✅ / 🔄

#### 现象实录（同一语料：`personal/个人简历-潘展飞.md`）

| 来源 | 用户问 | 实际回答（摘要） | 问题类型 | 坑 ID |
|------|--------|------------------|----------|-------|
| Golden G1 | 你好 | 「你好，**大表哥**…」 | Intake `briefReply` 乱称呼 | **P0-13** |
| Golden G2 | 我的名字 | 「**知识库没有**…**长期记忆**已知潘展飞」 | corpus / Mem0 自相矛盾 | **P0-14** |
| Golden G2（早先） | 我的名字 | 「《个人简介》**陈明** / Charlie」 | 空 hits 幻觉（**路径 B，待验证**） | **P0-12** |
| Web / agent-log（2026-06） | 我的名字 | KM₁ 有 hits → FC 打回 → KM₂ query「姓名 全名 完整称呼」→ 乱答 | FC meta refined 毁掉首轮证据（**路径 A**） | **P0-17** |
| Web | 我叫什么 年龄 职业 从业经历 | **赵一**，28 岁，秦汉新城智慧园林… | 完全编造另一人 | **P0-15** |
| Web（同问再跑） | 同上 | **潘展飞**，职业/经历 + 简历 path 引用 | **正确** | （对照基线） |
| Web（同问再跑） | 同上 | 年龄字段答成「10 年前端经验」而非出生日期 | 字段映射 / hits 不全 | **P0-15** 延伸 |
| Web | 对话 A：记住 QQ → 对话 B：我的 QQ？ | 对话 B **不知道** / 未引用 Mem0 | 跨会话用户自述事实未召回 | **P0-16** |

**语料事实（ground truth）：** 姓名 **潘展飞**；语料中**不存在**赵一、陈明、大表哥、《个人简介》独立文档。

#### 根因归纳（待改代码验证）

| 层级 | 共性问题 |
|------|----------|
| **Intake** | `chitchat` 的 `briefReply` 无硬约束（P0-13） |
| **KM** | `personal/` 检索不稳定；复合问法一次 hit 简历、一次 hit 别的 chunk 或空（P0-15、D3-2） |
| **FactChecker** | meta `refinedSearchQuery` 打回 KM₂（**P0-17**）；二次 force_pass 后弱/空 hits 仍放行（**P0-12，待验证**） |
| **Analyst** | hits 空/弱仍调 LLM；训练数据填「假简历」（赵一）；未强制 citations 来自 hits（P0-12、P0-15）；P0-17 下游受害 |
| **Mem0** | 与 corpus 结论可同句冲突（P0-14）；跨会话自述事实（QQ 等）未召回（P0-16） |

#### 解决排期（记录用 · 非断言清单）

| 优先级 | 对策 | 解决哪条现象 | 计划日历 | 改动面 |
|--------|------|--------------|----------|--------|
| **P0** | FC：`personal/` + 姓名类 → pass；meta refined **不覆盖、不重检 KM**（P0-17） | KM₁ 好 → KM₂ 坏 | **当前优先** | `fact-checker/check-facts.ts`、`check-helpers.ts` |
| **P0** | Analyst：`hits=[]` / `coverage=none` **不调 LLM**，直出 fallback（**P0-12，验证后做**） | 陈明类幻觉（路径 B） | Day 3 | `information-analyst/stream.ts` |
| **P0** | Intake：`briefReply` 模板或后检（禁昵称；宜含 FamBrain/助手） | 大表哥 | Day 3 | `intake-coordinator` prompt / 规则 |
| **P0** | Analyst：Mem0 **不得**与「知识库无记录」同句补履历；个人信息以 hits 为准 | P0-14 | Day 3 + D3-9 | `information-analyst` prompt、`build-prompt-block` |
| **P0** | 跨会话 **remember_fact** 显式写入 Mem0；联系方式类 Mem0 优先于空 corpus | P0-16 | Day 3 + D8 | `intake-coordinator`、`mem0/store.ts`、`persist-turn.ts` |
| **P0** | KM 规则精排 + `personal/` 加权；复合问拆 subTasks | 赵一 / 潘展飞波动 | **Day 6～7** | `retrieve.ts`、Intake |
| **P1** | 生成后 citation / 姓名校验（answer 人名 ∈ hits excerpt） | P0-15 | Day 8～9 eval | D5-3 |
| **P1** | Golden 加 **G-个人档案**（非仅 G2 单句）；`GOLDEN_RUNS=3` 稳定性 | 回归验收 | Day 2～3 记坑后 **消坑后再收紧断言** | `golden-regression.ts` |
| **P1** | Golden **G-跨会话记忆**：对话 A 记 QQ → 对话 B 问 QQ 须命中 | P0-16 | Day 3 消坑后 | `golden-regression.ts` |

#### 验收标准（消坑后）

- [ ] 「你好」10 次无「大表哥」类称呼（P0-13）
- [ ] 「我的名字」3 遍均含 **潘展飞**，无陈明/赵一，无「库里无 + 记忆有」同句（P0-14）；agent-log 无 FC meta refined 打回（P0-17）
- [ ] 复现 **路径 B** 后：`hitCount=0` + FC force_pass 时 Analyst 不调 LLM（P0-12）
- [ ] 「我叫什么 年龄 职业 从业经历」3 遍姓名均为 **潘展飞**，且至少 1 条 citation 来自 `personal/个人简历`（P0-15）
- [ ] `pnpm run golden:regression` 与 `GOLDEN_RUNS=3` 稳定性汇总 **≥4/5 且全轮无 P0-12～16 类现象**
- [ ] 对话 A 记 QQ（或手机）→ 新建对话 B 问同项 → answer 含该值（P0-16）

**Golden 脚本定位：** 当前 G1～G5 为 **冒烟 + 基线分数**；上表 P0-13～16 的**严格断言**在对应代码消坑后再并入 Golden，避免「测了但假绿」。

### 2.6 跨会话用户自述事实未召回（2026-06 · Web 联调）

> **背景：** 用户在**对话 1** 让助手记录 QQ 号并确认；**新建对话 2** 问「我的 QQ 是多少？」时助手不知道。与 **P0-14**（corpus 与 Mem0 同句矛盾）不同：本节是 **Mem0 应跨会话、却完全没带上**。

#### 现象摘要

| 步骤 | 会话 | 用户 | 实际 | 与预期 |
|------|------|------|------|--------|
| 1 | 对话 A | 「记住我的 QQ 是 …」 | 助手确认已记录 | Mem0 / 语料应持久化 |
| 2 | 对话 B（新） | 「我的 QQ 是多少？」 | 不知道 / 知识库无记录 | 应引用 Mem0 或已写入语料 |

#### 与 P0-14 / #16 的区别

| | P0-14 | P0-16（本节） | 通用 #16 |
|--|-------|---------------|----------|
| 场景 | 同轮：corpus 说无 + Mem0 说有 | **跨 conversationId**：上轮记、下轮忘 | 多轮内偏好遗忘 |
| 体感 | 一句话自相矛盾 | 「你刚才不是记住了吗？」 | 第 5 轮忘了第 1 轮说的 |

#### 根因分析（待 Day 3 验证）

| 层级 | 根因 | 说明 |
|------|------|------|
| **LangMem** | 按 `conversationId` 隔离 | 对话 B **不会**读到对话 A 的会话摘要；跨会话只能靠 Mem0 |
| **Mem0 写入** | 轮次结束 `addTurnToMem0(userQ, assistantA)` 依赖 LLM **抽取**事实 | 「记住 QQ」可能未抽成结构化记忆；失败时 `persistPipelineMemory(...).catch(() => undefined)` **静默丢弃** |
| **Mem0 检索** | `searchUserMemories(actorUserId, userQuestion)` 为语义检索 | 「我的 QQ」与存储表述 embedding 不对齐 → `userMemories=[]` |
| **Analyst / Intake** | 问 QQ 走 **needsRetrieval** → corpus 无 QQ → hits 空 | 空 hits 路径可能 **不用** Mem0（与 P0-14 对策「hits 空不用 Mem0 补履历」需区分：**用户自述联系方式应允许 Mem0**） |
| **临时方案** | 写入 `corpus/personal/*.md` 并 re-index | RAG 可答，但不等于 Mem0 跨会话设计 |

**链路（通俗）：** 对话 1 结束时系统「尝试」把整轮对话塞进长期记忆抽屉 → 抽屉里可能没有单独一张「QQ」标签 → 对话 2 问 QQ 时抽屉搜不到 → 又去书架上找（语料）也没有 → 只能说不知道。

#### 对策（计划 · Day 3 + D8）

| 优先级 | 对策 | 改动面 |
|--------|------|--------|
| P0 | Intake 识别 **remember_fact** / **update_profile**（「记住」「我的 QQ 是」）→ 结构化写入 Mem0（键值或单条 memory），不只靠轮次后抽取 | `intake-coordinator`、`mem0/store.ts` |
| P0 | 联系方式 / 账号类 query：**Mem0 search 优先**；corpus hits 空时仍可用 Mem0 作答，与「履历类 hits 空禁用 Mem0」分流 | `information-analyst` prompt、`prepare-context.ts` |
| P0 | `persistPipelineMemory` 失败 **打 agent-log / 不吞错**；可选 Mem0 add 后 verify search | `pipeline/graph/stream.ts` |
| P1 | Golden **G-跨会话记忆**：固定 conversationId A/B，A 记 fact → B 问 | `golden-regression.ts` |
| P2 | 用户确认「写入语料」时追加 `corpus/personal/` 并触发增量 index | 产品化；非 P0 |

**验证：** 对话 A 记 QQ → 新建对话 B 问 QQ → answer 含正确号码；`agent-log` Mem0 search 在 B 轮 `extractedCount ≥ 1`。

**临时 workaround：** 将 QQ 写入 `data/doc/users/<corpusUserId>/corpus/personal/` 对应 md → `pnpm run index:corpus`。

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
| D5-5 | Analyst + FC | **路径 B：** 同轮 FC 二次 force_pass 后 KM 仍空/弱 hits，Analyst LLM 编造终稿（**P0-12**，待验证） | FC `force_pass_after_retry` 只写 notes；Analyst 无空 hits 硬兜底 | 见 §2.2.1；验证后再改 `stream.ts` | ⬜ 待复现 |
| D5-6 | FC + 编排 | **路径 A：** KM₁ 有 hits，FC meta `refinedSearchQuery` 导致 KM₂ 变差（**P0-17**） | LLM refined + 编排无条件覆盖 searchQuery | 见 §2.2.2：`refined-search-query.ts` + `personal_skip_llm` + `mergeRetrySearchQuery` | ✅ **已解决**（2026-06） |

**验证脚本：** `pnpm run verify:fact-checker`、`pnpm run golden:regression`（`apps/agents/package.json`）。

#### 2.2.1 路径 B — Analyst 空 hits 幻觉（P0-12 · 待复现验证）

> **背景：** Golden / Web 早先联调「我的名字」时，**偶发**答「根据《个人简介》，你的名字全称为**陈明**…」；语料仅有 **潘展飞**。 hypothesized 链路：**两轮 KM 后 hits 仍空** → FC force_pass → Analyst LLM 幻觉。
>
> **与 P0-17 拆分：** 本节是 **路径 B**（KM 最终空/弱 + force_pass）；**§2.2.2 路径 A** 是 KM₁ 曾有 hits，被 FC 坏 refined 打回后 KM₂ 变差。**两条都要修，但验证与改代码顺序分开。**

**假设链路（待 agent-log 确认）：**

```text
用户「我的名字」→ Intake → KM₁ hits 空或弱
  → FC 第 1 次：打回再检索（D5-1）
  → KM₂ 仍空/弱
  → FC 第 2 次：retryCount≥1 → passed=true（force_pass_after_retry）
  → Analyst 仍调 LLM → 编造「陈明」（训练数据幻觉）
```

**与相关坑的分工：**

| 层级 | 坑 ID | 角色 |
|------|-------|------|
| 上游 | **D3-2** | KM 有 candidates 却 `hits:[]` |
| 中游 | **D5-1** | 同轮两次 FC 是设计 |
| 下游 | **P0-12 / D5-5** | Analyst hits 空仍调 LLM |
| 易混 | **P0-17 / D5-6** | KM₁ 有 hits 却被 FC 打回 — **不是本路径** |

**典型日志（预期，待复现）：**

```text
📚 [KnowledgeManager] 📤 出去  { hitCount: 0, ... }   // KM₂ 仍空
🔍 [FactChecker] 📤 出去  { passed: true, source: rules_fallback, retryCount: 1, ... }
🧠 [InformationAnalyst] 📤 出去  { source: "llm", answerPreview: "…陈明…" }
```

**「不进 Analyst 进哪儿？」** 检索类问题终稿仍由 Analyst 合同负责；P0-12 对策是 **Analyst 节点内 hits 空时不调 LLM、直出 fallback**（或编排 `respondEarly` 固定话术），不是换 Agent。**先复现路径 B 再改。**

**验证：** Web 问「我的名字」；`agent-log` 须同时满足：KM₂ `hitCount=0`、FC 第二次 `passed=true`、`willRetryRetrieval=false`；再断言 Analyst 是否仍 `source: "llm"`。

#### 2.2.2 路径 A — FC meta refined 打回毁掉 KM₁（P0-17 · ✅ 已消坑 2026-06）

> **背景：** 2026-06 Web / agent-log 实测「我的名字」：**KM₁ 正常有 hits**，FC 打回并产出 `refinedSearchQuery: "姓名 全名 完整称呼"`，编排覆盖 `decision.searchQuery` 后 **KM₂ 检索变差** → 乱答。

**链路（改前 · 实测）：**

```text
Intake searchQuery: "个人简介 简历 姓名"
  → KM₁：hitCount≥1，path 含 personal/个人简历-潘展飞.md
  → FC 第 1 次：passed=false，refinedSearchQuery="姓名 全名 完整称呼"
  → compile 覆盖 decision.searchQuery → KM₂ 用坏 query
  → hits 变差 / excerpt 仅标题 → Analyst insufficientEvidence 或乱答
```

**落地改动（文件 → 行为）：**

| 文件 | 函数 / 逻辑 | 行为 |
|------|-------------|------|
| `fact-checker/refined-search-query.ts` | `META_REFINED_TOKENS`、`stripMetaFromSearchQuery` | 去掉「全名 / 完整称呼 / 检索词 …」等 meta 词 |
| 同上 | `hasPersonalCorpusHits` | path/title 匹配 `personal/`、`个人简历` |
| 同上 | `mergeRetrySearchQuery` | 合并首轮 query + strip 后 refined；**相对首轮无新 token → `shouldRetry: false`**，`skipReason: "refined_merge_no_increment"` |
| `fact-checker/check-facts.ts` | `personal_skip_llm` 分支 | hits 含 personal 且 userQuestion 为姓名类 → **不调 FC LLM**，直接 `passed: true`，`source: "rules_personal_pass"` |
| `fact-checker/check-helpers.ts` | `applyFactCheckGuards` | LLM 结果经 guard；无效 refined 不触发 KM 二次检索 |
| `intake-coordinator/prompt.ts` | identity 示例 | 姓名类 query 应含「个人简介 / 简历」等语料目录词（不写死人名） |
| `scripts/verify-fact-checker.ts` | 新增用例 | meta refined、personal pass、merge 无增量 |

**改后典型日志（Web 联调通过）：**

```text
📚 [KnowledgeManager] 📤 出去  { hitCount: ≥1, resultSource: "rule", paths: [".../personal/..."] }
🔍 [FactChecker] 📤 出去  {
  passed: true,
  source: "rules_personal_pass",
  guardApplied: "personal_skip_llm",
  willRetryRetrieval: false
}
（不应出现第二次 KnowledgeManager 📥 进入）
```

**验证：** 问「我的名字是什么？」→ FC `passed=true` 且 `willRetryRetrieval=false`；日志中**无**第二次 KM、`refinedSearchQuery` 不含「全名 完整称呼」。

### 2.1 D3 / LangChain 联调踩坑（2026-05-22）

> **背景：** 入库 + 在线检索由 LlamaIndex 迁至 **LangChain**（`@langchain/community` Chroma + `@langchain/ollama` Embeddings）；向量预扫已通，Golden G4 仍偶发 `hits:[]`。

| ID | 环节 | 现象 | 根因 | 对策（计划） | 状态 |
|----|------|------|------|--------------|------|
| D3-1 | 架构 | 入库 LlamaIndex、检索 LangChain 双栈 | 历史选型 + 渐进迁移 | 已统一 LangChain；`knowledge/chroma-rag.ts` 共享配置 | ✅ 已解决 |
| D3-2 | KM | **`candidateCount:12` 但 `hits:[]`**（P0-3 复发） | 向量语义召回 OK；~~LLM 精排空~~；关键词 fallback 按字面 token，与向量候选不匹配 | **`ensureNonEmptyHits`**：candidates 非空时禁止最终 hits 为空；保留向量 score | ✅ **已解决**（2026-06） |
| D3-3 | KM | 日志常见 `notes: 仅关键词匹配…` / `resultSource: "llm"` | ~~LLM 精排 JSON 不稳定~~ | **移除 KM 在线 LLM**；统一 `resultSource: "rule"`；excerpt 由 `pickExcerpt` 截原文 | ✅ **已解决**（2026-06） |
| D3-4 | KM | Intake 扩写含 `urban-governance` / `tech-stack` 等英文 tag | topics 拼进 tokenize，中文语料无字面命中 | topics 参与向量 query；规则 fallback 仍 tokenize topics — 英文 tag 字面未命中时靠向量 score / Top1 兜底 | 🔄 部分缓解 |
| D3-5 | KM | 向量 `score` 在 `loadCandidates` 后丢失 | candidate 类型只有 path/title/body | candidate 带 `score`；`vectorScoreToRelevance` 参与排序；Top1 兜底保留 score | ✅ **已解决**（2026-06） |
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

**链路说明（通俗）：** 向量「书架找书」成功 → 规则按 token 摘 excerpt；若 chunk 切在标题处、正文「姓名」在下一 chunk，excerpt 可能仍缺实体 → Analyst 需结合 title / path 推断（见 P0-6）。

> **消坑详情见 §2.1.1**（P0-4 / D3-2 / D3-3 / D3-5 落地代码、改前改后日志、验证命令）。

#### 2.1.1 KM 移除在线 LLM · 规则精排（P0-4 / D3-2 / D3-3 / D3-5 · ✅ 已消坑 2026-06）

> **触发问句：**「我的名字是什么？」（Intake → `searchQuery: "个人简介 简历 姓名"`）

**改前现象（agent-log）：**

| 字段 | 实际值 | 问题 |
|------|--------|------|
| `resultSource` | `"llm"` | 多一轮 ChatOllama invoke（常 **1～3s**） |
| Top hit excerpt | 仅 `# 潘展飞 · 简历摘要` 标题行 | chunk 边界 + LLM 未摘表格 |
| `notes` | `"未发现姓名实体"` | 小模型**编造**负向结论 |
| `coverage` | `partial` / 误导 Analyst | 下游 `insufficientEvidence: true` |

**根因：** KM 用 **ChatOllama 做精排**（选 hit、写 excerpt、写 notes）。7B/14B 在「只许从 candidate 摘录」约束下仍不稳定：空选、改写 excerpt、幻觉 notes，比规则路径更差。

**架构决策：** 检索层只做 **recall + 结构化 evidence**；开放式生成仅保留在 **Analyst**。与 Self-RAG / Corrective RAG 分工一致（grader ≠ generator；retriever 不用 Chat LLM）。

**落地实现（`knowledge-manager/retrieve.ts`）：**

```text
searchQuery + corpusUserId
  → L1a: searchCorpusVectors()              // @fambrain/corpus，Chroma L2
  → isVectorConfident(top1, gap)?           // top1 ≤ 1.25 且 top1-top2 ≥ 0.12
      ├─ 是 → 向量 candidates
      └─ 否 / 空 → L1b: scanDocCandidates() // 扫 experience|projects|personal
  → mergeCandidates()（低置信时合并向量 + 扫盘，按 path 去重）
  → retrieveByKeywords()                    // token 命中 + vectorScoreToRelevance
  → ensureNonEmptyHits()                    // D3-2：candidates>0 则 hits 必 ≥1
  → logAgentOut resultSource: "rule"
```

| 模块 | 常量 / 函数 | 说明 |
|------|-------------|------|
| 召回 | `MAX_CANDIDATES=12`, `MAX_HITS=5` | 与旧版一致 |
| 向量置信 | `VECTOR_CONFIDENT_TOP1_MAX=1.25`, `VECTOR_CONFIDENT_GAP_MIN=0.12` | L2 距离；见 `getKmRetrievalConfig()` |
| 分词 | `tokenize()` | 英文/数字 ≥2 字；中文长串二元切分 |
| 摘录 | `pickExcerpt(body, tokens)` | 最早 token 命中 ±60 字，`EXCERPT_MAX=320` |
| 相关度 | keyword ∪ `vectorScoreToRelevance` | top≥0.6 → sufficient；>0 → partial |
| 兜底 | `ensureNonEmptyHits` | token 未命中时取向量/扫盘 Top1，`relevance≥0.35` |

**删除 / 精简：**

| 项 | 说明 |
|----|------|
| `ChatOllama` invoke | KM 内精排 LLM |
| `coalesceRetrieval()` | LLM 与 keyword 合并、LLM 优先 |
| `vector-retrieve.ts` | 在线统一 `@fambrain/corpus` `searchCorpusVectors` |
| `prompt.ts` LLM prompt | 仅保留类型合同 |

**改后实测（Web 联调 2026-06）：**

```text
📚 [KnowledgeManager] 📤 出去 {
  hitCount: 5,
  coverage: "sufficient",
  resultSource: "rule",
  hits[0]: {
    path: ".../personal/个人简历-潘展飞.md",
    excerpt 含: "| 姓名 | 潘展飞 |"
  }
}
```

**收益：** excerpt 忠实原文；KM 无 Ollama 推理（📥→📤 **几十～几百 ms**）；`resultSource: "rule"` 可回归。

**验证：**

```bash
pnpm run verify:agent-schemas
pnpm run verify:fact-checker
# Web 问「我的名字是什么？」→ KM resultSource=rule，FC personal_skip_llm，无二次 KM
```

**仍待完善（KM v2）：** 见 [km-retrieval-design.md](./km-retrieval-design.md) KM-01～18；Analyst corpus/Mem0（P0-14）不在 KM 范围。

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
| P0-12 / D5-5 | #9 信息捏造（路径 B：force_pass 后 hits 空，Analyst 仍编造 — 待验证） |
| P0-17 / D5-6 | #4 计划漂移（FC 坏 refined 导致 Corrective RAG 二次检索跑偏） |
| P0-13 | #1 意图误判（chitchat briefReply 风格漂移） |
| P0-14 / P0-15 | #9 信息捏造；#16 关键信息遗忘（Mem0 vs corpus）；#15 信息不对称 |
| P0-16 | #16 关键信息遗忘（跨 conversationId；用户自述 fact） |
| R6-1 | #3 过早终止（枚举未穷尽）；#16 跨轮不一致；P0-11 / D5-2 |
| R6-2 | #16 关键信息遗忘；#17 上下文污染（当轮空 hits 否定 history）；D3-9 Analyst 不读全量历史 |

---

## 三、集中消坑计划（核心 Agent 完成后 · 并入 10 日质量冲刺）

> **前置：** 核心 Agent 与 D9 触达已完成 — `FactChecker`（D5）、`ContentOrganizer`（D6）、`DocParser`（D7）、`ContentSummarizer`（D9）、实验脚本（MCP/Recall/Vercel AI）。
>
> **执行计划：** 按天排期见 [路线图 · 质量冲刺 10 日计划](./03-roadmap.md#质量冲刺--10-日计划2026-06)。下表为**坑 ID → 交付**对照，原「约 4 天 sprint」已扩展为 **10 工作日 + 第 11 天总复盘**。

| 天 | 焦点 | 目标坑 ID | 交付 | 质量冲刺日历 |
|----|------|-----------|------|--------------|
| **消坑 D1** | KM 检索闭环 | D3-2～D3-5 | v1 ✅；v2 见 [km-retrieval-design.md](./km-retrieval-design.md) | **第 6～8 天**（KM 三日） |
| **消坑 D2** | 召回质量 | D3-6～D3-7、D3-10 | KM-01～07（D1）、KM-08～12（D2） | **第 6～8 天** |
| **消坑 D3** | 多轮上下文 + Analyst 兜底 + 跨会话记忆 | D3-8～D3-9、P0-10、**P0-12**、**P0-16** | Intake/Analyst 短历史；hits 空短路 LLM；Mem0 remember_fact | 与 R6 联调；**可提前 Day 3** |
| **消坑 D4** | 回归 + 文档 | D3-11～D3-12、P0-6、A6 | G1～G5 全自动脚本；docs/流程图/sync | **第 2～3 天** + **第 11 天** |
| **消坑 D5-消坑** | 跨轮少重复 | D5-2、P0-11；可选 D5-4 | 检索 cache；Intake 同句重复问 | **第 4～5 天** |
| **消坑 R6** | 工作经历枚举 + 追问一致 | R6-1、R6-2 | KM-13～15（D3）；Golden 4 家；R6-2 仍靠 Analyst | **第 6～8 天**（KM 三日） |
| **Eval / SLO** | 系统化 eval + 可观测 | #18、A6 扩展 | `run-eval` 报告；step 耗时 / token 日志 | **第 8～10 天** |

**完成标准（核心 Agent + 消坑）：**

- [x] 在线链路（P0）：Intake → KM（向量 + 关键词）→ **FactChecker** → **ContentOrganizer** → Analyst
- [ ] Golden **G1～G5 ≥4 条稳定通过**（允许 G5 clarify 行为一致即可）
- [x] D3-2 **KM 规则兜底**（`ensureNonEmptyHits`：12 candidates → hits 必 ≥1）← 2026-06
- [x] 踩坑表 **P0-4 / D3-3 / D3-5 / P0-17 / D5-6** 已标 ✅（§2.1.1、§2.2.2）
- [ ] P0-6 Analyst 有 hits 仍 insufficient ← 待回归
- [ ] D5-2：同会话连续两问 G4 原文，第二次不再全量向量检索（cache 或 Intake 复用）← §2.2
- [ ] **P0-12 / D5-5**：FC 二次放行且 `hits=[]` 时，Analyst 不得编造（须 fallback 或 `insufficientEvidence`）← §2.2.1
- [ ] **P0-13～P0-15**（Golden Day 2 实录）：无乱称呼、无赵一/陈明、corpus/Mem0 不矛盾 ← §2.5
- [ ] **P0-16**（Web 联调）：对话 A 记 QQ → 对话 B 问 QQ 可召回 ← §2.6
- [ ] R6-1：「哪几家公司上过班」类问题 → hits/answer 枚举 **4 家**且同句再问结果一致 ← §2.3
- [ ] R6-2：同会话表格/格式化追问 → **不得否定**上一轮已 grounded 的公司（如西安奥卡云）← §2.4

---

## 四、调试 checklist（每轮对话 · P0 + D3 + D5）

- [ ] 若出现**两次** `fact_checker` step：查 FactChecker 第一次是否 `passed=false`、是否打回再检索（D5-1，常伴 `retryCount: 1`）← §2.2
- [ ] 若**新一条消息**与上轮同句仍全链路：属 D5-2 未消坑，非 FactChecker 失效

- [ ] Intake 原始 JSON 是否合理（`intent` / `searchQuery` / `needsRetrieval`）
- [ ] KM 预扫 `paths` 是否有内容；**`hits` 是否非空（若 `candidateCount > 0`）** ← D3-2
- [ ] KM 日志 **`resultSource` 应为 `"rule"`**（不应再出现 `"llm"`）← D3-3 / P0-4
- [ ] 预扫 paths 是否同一 md 重复过多（chunk 去重）← D3-6
- [ ] Analyst 输入里 `hits` / `coverage` 是否与 KM 一致 ← P0-6
- [ ] 终稿是否出现候选中不存在的公司、项目、日期（幻觉）
- [ ] 换模型复现：区分 prompt 问题 vs 模型能力（`OLLAMA_MODEL` / `OLLAMA_MODEL_INTAKE_COORDINATOR`）
- [ ] agents 服务 `:3001` 是否唯一实例（无 EADDRINUSE）← D3-12
- [ ] FactChecker 日志：`passed` / `refinedSearchQuery` / `retryCount` 是否符合 §2.2 判定表
- [ ] **FC 二次放行 + hitCount=0**：Analyst 是否仍编造姓名/公司（**P0-12**）← §2.2.1；Golden G2
- [ ] **列举型问题**（「哪几家公司」）：KM `hits` 是否覆盖 `experience/` 下全部经历文件；同句再问 hits 数量是否骤降 ← R6-1 §2.3
- [ ] **格式化追问**（「用表格列出来」）：Intake 是否误开全量检索；Analyst 是否否定 history 中已确认公司 ← R6-2 §2.4
