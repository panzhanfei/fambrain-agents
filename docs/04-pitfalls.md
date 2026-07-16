# Agent 开发坑点清单

[← 返回 README](../README.md) · [流程图](./02-agent-flows.md)

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

> P0 条目来自 **2026-05 初版联调**；**§2.1** 来自 **2026-05-22**（LangChain 向量检索接入 + Golden 回归）。对策以 **prompt + 编排兜底** 为主。

### 踩坑分类索引

同类问题合并查阅；详细案例仍保留在下表与各 § 小节。

| 类别 | 典型现象 | 代表 ID | 详解 |
|------|----------|---------|------|
| **Intake / 意图路由** | 问候走检索、clarify 误触、续问被澄清 | P0-1、P0-13、**P0-29**、P0-25 | §2.5.1、§2.5.9、**§2.8.1** |
| **多槽 / PathPlan 编排** | 混合问丢段、列举+链接只出一段、routeMode 互斥 | P0-15、P0-26、P0-27、**P0-28** | §2.5.3、§2.5.10、**§2.8** |
| **KM / 检索召回** | hits 空、枚举不全、chunk 边界 | P0-3、P0-4、R6-1、D3-2 | §2.3、§2.1.1 |
| **FactChecker / 编排** | meta refined 打回、force_pass 后空 hits | P0-12、P0-17、D5-* | §2.2、§2.2.1、§2.2.2 |
| **Analyst / 终稿** | 幻觉、列举压缩、项目/公司槽混淆 | P0-19～21、P0-12 | §2.5.5 |
| **Cache / 跨轮** | 同句再问全链路、答案降级 | P0-11、D5-2、R6-3 | §2.2、§2.7 |
| **Mem0 / 用户事实** | corpus 与 memory 矛盾、跨会话遗忘 | P0-14、P0-16 | §2.5.2、§2.6 |
| **工具 / 确定性编排** | 年龄不计算、列举 blocks、联网 | P0-23、P0-24、P0-22 | §2.5.6、§2.5.7、[架构 v2 §11](./05-architecture-v2-tool-orchestration.md#11-pathplan-统一执行计划-2026-07) |

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
| P0-12 | Analyst + FC | **路径 B：** FC **二次 force_pass** 后 KM 仍 `hits=[]` / `coverage=none`，Analyst 编造终稿（陈明 / Charlie） | `streamAnalyzeInformation` hits 空仍调 LLM | **`shouldSkipAnalystLlm`** → `rules_empty_hits_skip_llm` 直出 fallback；`insufficientEvidence=true` | ✅ **已解决**（2026-06-18） |
| P0-17 | FactChecker + 编排 | **路径 A：** KM₁ 有 hits，FC 产出 meta 式 `refinedSearchQuery`（如「姓名 **全名 完整称呼**」），编排覆盖 `searchQuery` → KM₂ 变差 | FC LLM 把「怎么查」写成检索词；编排无条件覆盖；无 refined 有效性校验 | `personal/` + 姓名类 → **跳过 FC LLM 直接 pass**；`mergeRetrySearchQuery` meta  strip + 无增量不重检；见 **§2.2.2** | ✅ **已解决**（2026-06） |
| P0-18 | Intake / Cache / Analyst | 单问「今年多大」→ Intake `clarify`；composite 单槽空 hits 走「未标注年龄」；同问 1ms 复用错答 | Mem0 工作年限≠出生日期；终稿 cache 跳过 KM 但 merge 空；repeat 复用兜底文案 | Intake **示例 9**；`knowledge-manager/composite/retrieve.ts` citations→hits；`runtime/stream.ts` 单槽回放；三层 cache **env 可关**；`clear-pipeline-cache` | ✅ **已解决**（2026-06 · Web 复测）← §2.5.4 |
| P0-13 | Intake | Golden / Web「你好」→ `briefReply` 出现 **「大表哥」** 等未定义称呼 | `chitchat` 路径不经 Analyst；Intake 小模型在 `briefReply` 自由发挥 | **`applyIntakeChitchatGuard`** 服务端固定模板（LLM `briefReply` 须 null）；Intake JSON snake_case 归一 | ✅ **已解决**（2026-06-18）← `verify:intake-chitchat` |
| P0-14 | Analyst + Mem0 | Golden / Web「我的名字」→ 同句 **「知识库没有记录」+「长期记忆已知潘展飞」** 自相矛盾 | hits 弱时走 insufficientEvidence 话术，Mem0 又补姓名；**corpus 与 memory 优先级未定义** | **KM 优化**后 `personal/` 姓名类检索稳定 → hits 含简历，Analyst 直答 corpus；不再触发「空 hits + Mem0 补履历」路径 | ✅ **已解决**（KM 优化 · Web/G2 复测 2026-06） |
| P0-15 | Analyst | 同问「**我叫什么 年龄 职业 从业经历**」→ 一次答 **赵一 / 28 岁 / 秦汉新城智慧园林**（语料无此人），一次答 **潘展飞** + 简历引用（正确） | KM hits 波动 + Analyst 在 weak hits 下用训练数据填「完整简历模板」；复合问法单 queryType 单检索 | **Intake retrievalPlan** 主路由 + 动态槽 KM + merge；结构/subTasks 兜底；Analyst 禁推算年龄、enumeration 逐条列 | ✅ **已解决**（2026-06 · `verify:r6-no-cache` 综合履历 3 遍）← §2.5.3 |
| P0-16 | Mem0 / Analyst | **对话 A** 用户说「记住我的 QQ 是 xxx」…；**G1** chitchat JSON 缺 `userFact*` → parse 失败 → 误检索 | 见 §2.6 · §2.5.6 | Intake schema `preprocess` + userFact 节点 + Golden GMem | ✅ **已解决**（2026-06）← §2.6 · §2.5.6 |
| R6-1 | KM / Analyst | **「我在那几家公司上过班？」** 应枚举 **4 家**，首轮只答 **2 家**（西安奥卡云、苏州奖多多）；**同句再问** 仅确认 **1 家** 并称其余「知识库无记录」 | 见 §2.3 | composite 分槽 + enumeration KM；`verify:r6-no-cache` 验收 | ✅ **已解决**（2026-06 · cache 全关 4 家×2 轮）← §2.3 |
| R6-2 | Analyst / 上下文 | **同会话追问**（如「用表格列出来 时间 职位 公司名称」）：上一轮已确认 **西安奥卡云**，本轮却称「没有明确列出具体公司」 | 见 §2.4 | 全链路重检 + 表格追问保留 grounded 公司 | ✅ **已解决**（2026-06 · `verify:r6-no-cache`）← §2.4 |
| R6-3 | Intake / KM / Analyst | **同会话**：综合问首轮 **4 家**；编号子问或重复问后仅 **2 家** | 见 §2.7 | composite 分槽 + eval **`G-履历综合`** + `verify:r6-no-cache` | ✅ **已解决**（2026-06 · eval 4/4 + 无 cache 11/11）← §2.7 |
| P0-19 | Analyst | 单问列举/档案走 **JSON+think** 解析失败 → 终稿变「**根据知识库摘录**」+ 整段 excerpt（像内部检索结果） | 单问与 composite 子问路径不一致；JSON parse 失败静默 `buildFallbackAnswer` 旧格式 | **plain-text 流式**（`prefersPlainTextAnalystStream`）；fallback 改 **紧凑列表** | ✅ **已解决**（2026-06）← §2.5.5 |
| P0-22 | Analyst / KM / Web UI | **综合问**项目段只列 **2/36**；单问「列出全部」误解为应一页穷尽 | LLM 压缩；hybrid Top-8；分页 pageSize=20 | **enumeration skip LLM** + 分页 API + 序号仅项目名 + 分页文案 | ✅ **已解决**（2026-07）← §2.5.6 |
| P0-23 | Analyst | 单问「今年多大」→ excerpt 有 `1993.03` 却只复述「出生日期…可推算」，**不给岁数** | P0-15/18 prompt **禁止 LLM 推算年龄**；pipeline 未注入 asOfDate；无服务端 age tool | **`compute_age_from_hits`**（P0-23 Analyst 内联）→ **P0-24 上移到 ToolOrchestrator** | ✅ **已解决**（2026-07）← §2.5.7 · [架构 v2](./05-architecture-v2-tool-orchestration.md) |
| P0-25 | Intake / KM / Analyst | 问「开源项目 **GitHub 链接**」→ 答 **aky 内部路径**；应 **2 条 URL** 只给 release-bot；「不止这一个」→ **clarify**；点名物联网/工具库 → 一未覆盖、一错绑 release-bot | Intake 误标 **enumeration** → KM **projects fill** 扫 offline 文档；会话 **stale subTasks** 继承；省略续问误 clarify；Analyst 跨槽借 URL | **`queryType=external_link`** + **`applyIntakeContinuationGuard`** + **`applyIntakeLinkLookupGuard`** + KM **`applyExternalLinkGuard`** + Analyst external_link 规则 | ✅ **已解决**（2026-07）← §2.5.9 |
| P0-26 | Intake / KM / 编排 | **混合问**「React 经验 + **列出全部项目**」→ 整句走 list、tech 段丢失；续问「更多项目」靠 **口语 regex** 误判 | P0-22 用 **整句 `routeMode=list`** 表达穷举；`enumeration-list-intent` 堆 regex，与 per-slot composite 冲突；KM 无 **按槽 executor** | **per-slot** `enumerationControl` + `executor=km_retrieve\|list_corpus`；`applyEnumerationSlotGuard`；UI **`ENUMERATION_ACTION_PROMPTS`** exact-match；`retrieval-node` 按槽执行 | ✅ **已解决**（2026-07）← §2.5.10 · [架构 v2 §10](./05-architecture-v2-tool-orchestration.md#10-列举执行-per-slot-演进-2026-07) |
| P0-27 | Intake / Web | 「列出全部项目 + **开源** GitHub/线上地址」→ 第 2 段变成「**每个**项目的 GitHub」且无 URL；前端无分页按钮 | LLM 双槽皆标 enumeration；link guard 误 aggregate；槽 id 撞车；Web BFF `pipeline_done` **丢 blocks** | Intake 示例 16 + `harmonizeRetrievalPlanQueryTypes`（`inferQueryProfile`）+ 保留混合 plan；`planItemToSlot` 唯一 id；BFF 透传 blocks；分页文案对齐 `ENUMERATION_ACTION_PROMPTS` | ✅ **已解决**（2026-07）← §2.5.10 · diagnose-mixed-projects-github-query |
| **P0-28** | Intake / KM / FC / 编排 | **混合问**「列举项目 + 开源 GitHub 链接」→ composite 只答 **一段**（或 external_link 槽被 label regex 漏掉）；FC 对 composite≥2 **整轮跳过** | `routeMode` / `compositeSlots` / `executionPlan` / toolPlan **四套多槽互斥**；opensource 与 enumeration **并行 KM** 而非依赖链；FC 一次失败拖垮全答 | **PathPlan** 四桶 + **`planExecutor`**；external_link 作 km 槽 + extract 工具（无场景 DAG）；**per-step FC**；`composeMode` 一次 composite | ✅ **已解决**（2026-07）← **§2.8** · [架构 v2 §11](./05-architecture-v2-tool-orchestration.md#11-pathplan-统一执行计划-2026-07) |
| **P0-29** | Intake | `verify:intake-chitchat` 偶发「你好」→ **`retrieve_and_answer`**；脚本断言逻辑反了 | 小模型对极短句非确定性；prompt 检索示例偏多；parse 失败 → `defaultIntakeDecision`；测试在 intent=chitchat 时误 throw | **`isPureSocialUtterance`** 入口跳过 LLM + **`applyPureSocialUtteranceGuard`** 覆盖误判；chitchat briefReply 仍走 P0-13 模板 | ✅ **已解决**（2026-07）← **§2.8.1** · `verify:intake-chitchat` |
| **P0-30** | Intake / KM / Analyst / Web | 超长复合履历问：重复「工作经历/任职」、表头误「项目名称」、年限只算近段、近两年未过滤；`labels` 口语二次规划 | Intake 过拆 + repair 口语注入；canonicalize 盖掉 tenure 检索词；UI 写死表头；list 无时间窗 | **LLM 主导合并拆分**；schema 合法化 + facet 去重；`tenure` + `timeWindowYears`；职位/链接 UI；单测迁 `tests/` | ✅ **已解决**（2026-07）← **§2.9** · [架构 v2 §12](./05-architecture-v2-tool-orchestration.md#12-intake-llm-主导--schema-兜底2026-07--去问句硬编码) |
| P0-20 | Analyst / KM / composite | **综合问**公司段只列 2 家；子问「2～8 句」压缩；Organizer 固定 cap **5** | `MAX_SUB_QUESTION_HITS=4`；子问 prompt 句数限制；CO 未跟 profile | **`maxAnalystHitsForProfile`** + CO **`queryProfile` maxHits**；enumeration 子问 prompt「须列全 hits」 | ✅ **已解决**（2026-06）← §2.5.5 |
| P0-21 | Intake / KM / Analyst | composite 槽 label「**具体项目名称**」→ 答 **云联智慧/友谊时光** 等公司 | 所有 enumeration 共用 **experience fill**；Intake 误标 `topics:experience` → canonical 到 employers | **`resolveEnumerationTarget`**（label 优先）+ KM **projects/** 专扫 + Analyst project prompt | ✅ **已解决**（2026-06）← §2.5.5 |

### 2.8 PathPlan 统一编排（✅ P0-28 · 2026-07）

> **背景：** 用户问「列出全部项目 + 各开源项目的 GitHub 地址」。Intake 已正确产出 2 槽（enumeration + external_link），但终稿常只出现 **一段**（如仅 aky 内部路径段），或 FC 对 composite 整轮 skip 导致证据未审。

#### 现象摘要（案例）

| 用户问 | 预期 | 实际（改前） |
|--------|------|--------------|
| 列举全部项目 + 开源 GitHub 链接 | 两段：项目列表 + 简历中 2 条公开 URL | 常只答一段；或 external_link 槽被 **label 正则** 漏配 |
| React 经验 + 列出全部项目（混合） | 同轮 tech KM + list 分页 | 整句 `routeMode=list` 劫持，tech 段丢失（P0-26 同类） |
| composite ≥2 槽 | 每段独立 FC，一段失败可局部重试 | 旧 FC **整轮 skip**；或一次打回拖垮全答 |

#### 根因（架构层）

| 层 | 问题 | 说明 |
|----|------|------|
| **路由模型** | `routeMode` 整句互斥 | 同句无法「list + km + dag 依赖链」并存 |
| **多槽实现分裂** | compositeSlots / toolPlan / executionPlan 各维护一套 | Intake 与 PlanExecutor 语义不一致，guard 顺序敏感 |
| **opensource 链接** | external_link 与 enumeration **并行 KM** | 应 **先 list 实体 → 再抽 URL**（有 deps 的子图） |
| **FactChecker** | 单次、composite≥2 跳过 | 不符合「每路径审证据」；一段 hallucination 污染 composite |
| **硬编码** | label 口语猜 external_link 槽 | 与 P0-25「只信 queryType」原则冲突 |

#### 对策（已实现）

| 模块 | 改动 |
|------|------|
| `path-plan/interface.ts` | `PathPlan` 四桶：`km` / `list` / `tool` / `dag`；`ComposeMode` |
| `path-plan/compile-path-plan.ts` | `retrievalPlan` → PathPlan 分桶；保留 Intake 槽顺序；external_link → km |
| `path-plan/dag-templates.ts` | 仅 `hybrid_multi_source`（多源汇合） |
| `tool-orchestrator/plan-executor.ts` | LangGraph **单节点**：调度四桶 + **per-step FC** + 后置 tool |
| `pipeline/graph/compile.ts` | 移除 retrieval/factChecker/dag/tool 互斥边 → **`planExecutor`** |
| `composite-slot-queries.ts` | `EXTERNAL_LINK_SLOT` canonical searchQuery |
| `information-analyst/stream.ts` | `composeMode=composite` 走 parallel composite 流 |

**链路（通俗）：** Intake 把子任务分进四个桶并标依赖 → PlanExecutor 按桶取数、**每段各自核查** → 整理师规范化 → Analyst **只混剪一次** 出终稿。

**验证：**

```bash
pnpm --filter @fambrain/brain-service run verify:composite-route
pnpm --filter @fambrain/brain-service run verify:composite-incremental
pnpm --filter @fambrain/brain-service run verify:tool-orchestration
pnpm --filter @fambrain/brain-service run verify:dag-hybrid
pnpm --filter @fambrain/brain-service exec tsx --env-file=../../.env scripts/diagnose-mixed-projects-github-query.ts
```

详见 [架构 v2 §11 PathPlan](./05-architecture-v2-tool-orchestration.md#11-pathplan-统一执行计划-2026-07)、[Agent 流程图](./02-agent-flows.md)。

#### 2.8.1 纯社交短路 — 「你好」误判 retrieve（✅ P0-29 · 2026-07）

> **与 P0-13 关系：** P0-13 解决 chitchat **briefReply 乱称呼**（服务端模板）；P0-29 解决 **intent 本身** 被小模型判成 `retrieve_and_answer`。

**现象：** `verify:intake-chitchat` 连跑「你好」，偶发 intent=`retrieve_and_answer` → 走全链路或「知识库未覆盖」。

**根因：**

| 层 | 说明 |
|----|------|
| LLM 非确定性 | 极短句语义空，小模型偏向 prompt 里大量的 retrieve 示例 |
| parse 兜底 | JSON 失败时 `defaultIntakeDecision` → retrieve |
| 测试脚本 | 曾在 `intent===chitchat` 时误 throw「不应走检索」 |

**对策：**

| 优先级 | 对策 | 文件 |
|--------|------|------|
| P0 | **入口短路**：`isPureSocialUtterance`（你好/hi/谢谢等）→ **跳过 LLM**，直接 chitchat 早退 | `signals/pure-social-utterance.ts`、`nodes/intake-node.ts` |
| P0 | **pipeline 覆盖**：LLM 仍被调用时，`applyPureSocialUtteranceGuard` 强制 intent=chitchat | `guards/intake-chitchat-guard.ts`、`intake-pipeline.ts` |
| +1 | briefReply 仍走 P0-13 **`DEFAULT_CHITCHAT_BRIEF_REPLY`** | `applyIntakeChitchatGuard` |

**验证：**

```bash
pnpm --filter @fambrain/brain-service run verify:intake-chitchat   # CHITCHAT_RUNS=10
```

**注意：** 仅匹配 **纯** 问候/感谢（≤24 字、无并列问句）；「你好，我叫什么」仍走 LLM 检索。

### 2.9 Intake 去硬编码与复合履历（✅ P0-30 · 2026-07）

> **背景：** 超长复合问（IT 干了多少年 / 哪几家公司职位 / 近两年项目 / 年龄姓名 / 全部项目 / 开源链接）答案碎、重复、表头错、年限只算奥卡云段。

#### 现象

| 现象 | 改前 |
|------|------|
| 工作经历后又来「任职公司及职位」 | repair / LLM 过拆两条 experience |
| 任职表头「项目名称」、无职位 | Web 写死表头；列举只输出 title |
| 「近两年项目」像全库 | 无 `timeWindowYears` 执行过滤 |
| 「项目经历」vs「所有项目」重复 | 同 `listKind=project` 未按 facet 去重 |
| 从业年限 ≈3 年 | tenure 检索被 identity 通用模板盖掉；excerpt 只剩基本信息表 |

#### 对策

| 层 | 改动 |
|----|------|
| 原则 | Intake **LLM 合并/拆分**；代码只 schema 合法化 + facet 去重（删口语 labels） |
| 年限 | `identityField=tenure` → `compute_tenure_from_hits`；时间线 excerpt 优先 |
| 近两年 | `enumerationControl.timeWindowYears` + list 过滤；有时间窗强制 `list_corpus` |
| UI | enumeration 表头信 `listKind`；反馈按钮单次置灰持久化；URL 新开页 |
| 测试 | 单测集中 `apps/brain-service/tests/` |

**验证：** `pnpm test:unit` · `scripts/diagnose-long-composite-career-query.ts`。详见 [架构 v2 §12](./05-architecture-v2-tool-orchestration.md#12-intake-llm-主导--schema-兜底2026-07--去问句硬编码)。

### 2.3 工作经历枚举不完整 / 同问不同答（✅ 2026-06 · `verify:r6-no-cache`）

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

**验证（2026-06 通过）：**

```bash
pnpm --filter @fambrain/brain-service run verify:r6-no-cache   # R6-1：同句再问 4 家一致（三层 cache 全关）
```

同会话连续两问「我在那几家公司上过班？」→ 两次 answer 均含 **4 家**（云联智慧、友谊时光、奖多多、奥卡云）。

### 2.4 同会话追问自相矛盾（✅ 2026-06 · `verify:r6-no-cache`）

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
| P0 | Intake 识别 **follow-up on prior retrieval**（含「表格 / 列出来 / 刚才 / 补充」+ 同主题）→ `| P0 | Analyst 注入 **上一轮 grounded answer 摘要**（或 citation 列表）；当轮 hits 为空时**不得否定** history 中已标注「知识库确认」的事实 | `information-analyst`、`pipeline` state |
| +1 | Golden **G-工作经历-追问表格**：首轮至少 1 家 → 追问表格 answer **仍含**该公司且不为「无记录」 | `scripts/experiments` |
| +1 | 表格类输出：Analyst prompt 允许「部分填表 + 缺项标注未知」，而非整表拒答 | `information-analyst` prompt |

**验证（2026-06 通过）：** `verify:r6-no-cache` R6-2 场景 — 首轮含西安奥卡云 → 表格追问仍保留奥卡云，无「没有明确列出」类全盘否定。

### 2.5 Golden Day 2 联调实录 — 问题记录与解决顺序（2026-06）

> **原则：** Golden **用来发现问题**；**坑点表用来记录与排期**；改代码消坑后再用 Golden 验收。**不是**「多加几条断言就算完成」。
>
> **工作流：** 跑 Golden / Web → 现象记入本节 + P0 表 → 对照根因选 sprint 对策 → 改代码 → 再跑 Golden（`GOLDEN_RUNS=3` 看稳定性）→ 坑位标 ✅ / 🔄

#### 现象实录（同一语料：`personal/个人简历-潘展飞.md`）

| 来源 | 用户问 | 实际回答（摘要） | 问题类型 | 坑 ID |
|------|--------|------------------|----------|-------|
| Golden G1 | 你好 | 「你好，**大表哥**…」 | Intake `briefReply` 乱称呼 | **P0-13** |
| Golden G2 | 我的名字 | 「**知识库没有**…**长期记忆**已知潘展飞」 | corpus / Mem0 自相矛盾 | **P0-14** ✅（KM 优化后） |
| Golden G2（早先） | 我的名字 | 「《个人简介》**陈明** / Charlie」 | 空 hits 幻觉（**路径 B**） | **P0-12** ✅ |
| Web / agent-log（2026-06） | 我的名字 | KM₁ 有 hits → FC 打回 → KM₂ query「姓名 全名 完整称呼」→ 乱答 | FC meta refined 毁掉首轮证据（**路径 A**） | **P0-17** |
| Web | 我叫什么 年龄 职业 从业经历 | **赵一**，28 岁，秦汉新城智慧园林… | 完全编造另一人 | **P0-15** |
| Web（2026-06-18） | 综合履历问 → 编号 1～4 子问（同会话） | 首轮 **4 家** 全对 → 第 3 轮仅 **2 家** 且称「两家公司」 | 同会话答案降级 | **R6-3** §2.7 |
| Web（同问再跑） | 同上 | **潘展飞**，职业/经历 + 简历 path 引用 | **正确** | （对照基线） |
| Web（同问再跑） | 同上 | 年龄字段答成「10 年前端经验」而非出生日期 | 字段映射 / hits 不全 / 槽答案坏缓存 | **P0-15** 延伸 · **P0-18** ✅ |
| Web | 「我今年多大了」等单问年龄 | 曾 clarify / 「未标注年龄」/ 同问 1ms 错答 | Intake clarify + composite 单槽 + repeat | **P0-18** ✅ |
| Web | 对话 A：记住 QQ → 对话 B：我的 QQ？ | 对话 B **不知道** / 未引用 Mem0；修复后曾误答「码」 | 跨会话用户自述事实 | **P0-16** ✅ |

**语料事实（ground truth）：** 姓名 **潘展飞**；语料中**不存在**赵一、陈明、大表哥、《个人简介》独立文档。

#### 根因归纳（待改代码验证）

| 层级 | 共性问题 |
|------|----------|
| **Intake** | `chitchat` 的 `briefReply` 已模板兜底（**P0-13** ✅） |
| **KM** | `personal/` 检索不稳定；复合问法一次 hit 简历、一次 hit 别的 chunk 或空（P0-15、D3-2） |
| **FactChecker** | meta `refinedSearchQuery` 打回 KM₂（**P0-17** ✅）；二次 force_pass 后空 hits → Analyst skip LLM（**P0-12** ✅） |
| **Analyst** | hits 空已 skip LLM（P0-12 ✅）；弱 hits 仍可能编造（赵一）（**P0-15**）；P0-17 下游受害已修 |
| **Mem0** | corpus/Mem0 同句矛盾（**P0-14** ✅，KM 稳定命中后不再触发）；跨会话自述事实（P0-16 ✅） |

#### 解决排期（记录用 · 非断言清单）

| 优先级 | 对策 | 解决哪条现象 | 计划日历 | 改动面 |
|--------|------|--------------|----------|--------|
| **P0** | FC：`personal/` + 姓名类 → pass；meta refined **不覆盖、不重检 KM**（P0-17） | KM₁ 好 → KM₂ 坏 | **当前优先** | `fact-checker/check-facts.ts`、`check-helpers.ts` |
| **P0** | Analyst：`hits=[]` / `coverage=none` **不调 LLM**，直出 fallback（**P0-12**） | 陈明类幻觉（路径 B） | Day 3 | `information-analyst/stream.ts` ✅ |
| **P0** | Intake：chitchat `briefReply` 服务端固定模板 | 大表哥 | Day 3 | `intake-chitchat-guard.ts` ✅ |
| **P0** | KM：`personal/` 姓名类检索稳定（identity query）→ hits 含简历，消除 corpus/Mem0 同句矛盾 | P0-14 | KM 优化 | `knowledge-manager/recall/retrieve.ts` 等 ✅ |
| **P0** | Analyst：Mem0 **不得**与「知识库无记录」同句补履历（**兜底**；主因已由 KM 解决） | P0-14 | Day 3 + D3-9 | 暂不必改；若 KM 再波动可补 prompt |
| **P0** | 单问年龄：Intake 示例 9 + 槽答案缓存/slot Analyst 路径 + cache env / 清 cache 脚本 | P0-18 | 2026-06 | `prompt.ts`、`runtime/stream.ts`、`knowledge-manager/nodes/`、`knowledge-manager/pipeline/`、`infra/config.ts` ✅ |
| **P0** | 跨会话 **remember_user_fact / recall_user_fact** Intake schema + userFact 节点 + Mem0 结构化读写 | P0-16 | 2026-06 ✅ | `user-fact/user-fact.ts`、`user-fact/nodes/user-fact-node.ts`、`mem0/store.ts` |
| **P0** | KM 规则精排 + `personal/` 加权；复合问拆 subTasks | 赵一 / 潘展飞波动 | **Day 6～7** | `retrieve.ts`、Intake |
| **P1** | 生成后 citation / 姓名校验（answer 人名 ∈ hits excerpt） | P0-15 | Day 8～9 eval | D5-3 |
| **P1** | Golden 加 **G-个人档案**（非仅 G2 单句）；`GOLDEN_RUNS=3` 稳定性 | 回归验收 | Day 2～3 记坑后 **消坑后再收紧断言** | `golden-regression.ts` |
| **P1** | Golden **GMem 跨会话记忆**：A 记 QQ → B 问 | P0-16 | 2026-06 ✅ | `golden-regression.ts` GMem · `eval:run` **memProbe** |

#### 验收标准（消坑后）

- [x] 「你好」10 次无「大表哥」类称呼（P0-13）← `verify:intake-chitchat`（`CHITCHAT_RUNS=10`）✅
- [x] 「我的名字」无「库里无 + 记忆有」同句矛盾（P0-14）← KM 优化后 Web/G2 复测 ✅
- [x] 「我的名字」3 遍均含 **潘展飞**，无陈明/赵一（P0-15 延伸）；agent-log 无 FC meta refined 打回（P0-17）← 随 P0-15 ✅
- [x] 复现 **路径 B** 后：`hitCount=0` + FC force_pass 时 Analyst 不调 LLM（P0-12）← `verify:analyst-empty-hits` ✅
- [x] 单问「我今年多大 / 多大了」走 `routeMode=slots`（1 槽）+ 简历 excerpt 含出生日期；无 clarify / 无「未标注年龄」兜底（**P0-18**）← Web 复测 + `diagnose-age-query.ts` ✅
- [x] 「我叫什么 年龄 职业 从业经历」3 遍姓名均为 **潘展飞**，无赵一/陈明（**P0-15**）← `verify:r6-no-cache` ✅
- [x] `GOLDEN_RUNS=3` Golden 稳定性 **7/7×3**（2026-06）
- [x] 对话 A 记 QQ（或手机）→ 新建对话 B 问同项 → answer 含该值（P0-16）← `verify:user-fact` · **GMem** Golden ✅

**Golden 脚本定位：** G1～G5b + **GMem**（7 项）；`GOLDEN_RUNS=3` 连跑 **7/7×3** ✅（2026-06）。P0-13～16 专项脚本 + Golden 双重验收。

#### 2.5.1 P0-13 — chitchat briefReply 乱称呼（✅ 2026-06-18）

**改动：** `intake-chitchat-guard.ts` — `intent=chitchat` 时一律注入 `DEFAULT_CHITCHAT_BRIEF_REPLY`（LLM `briefReply` 须 null，不再禁词表白名单）。顺带 `schema.ts` 兼容模型 `brief_reply` 等 snake_case。

**验证：** `pnpm --filter @fambrain/brain-service run verify:intake-chitchat`（默认 `CHITCHAT_RUNS=10`）。

#### 2.5.2 P0-14 — corpus 与 Mem0 同句矛盾（✅ KM 优化 · 2026-06）

**原现象：** 「我的名字」→ Analyst 同句「知识库没有…」+「长期记忆已知潘展飞」。

**实际修复：** KM 优化后 `identity` / `personal/` 检索稳定命中 `个人简历` chunk，Analyst 有 hits 直答 **潘展飞**，不再走 `insufficientEvidence` + Mem0 补姓名。Analyst prompt 层面对 Mem0/corpus 优先级**暂未另改**；若 KM 再波动可再补 D3-9 兜底。

**复测：** Web「我的名字」+ Golden G2 冒烟；无 corpus/Mem0 同句打架。

#### 2.5.3 P0-15 / R6-3 — composite 分槽检索（✅ 2026-06）

**完整路由（Intake 主信号 + 结构兜底，2026-06 修订）：**

| 层 | 模块 | 职责 |
|----|------|------|
| **L0 入口 guard 链** | `intake-pipeline.ts` 等 | LLM 指代/clarify 早退 → chitchat → **retrievalPlan 补全/ canonicalize** → composite 路由 |
| **Intake retrievalPlan** | `prompt.ts` + `schema.ts` | 多问并列时 LLM 输出每项 `{ label, searchQuery, queryType, topics }`；编排**优先**据此定槽 |
| **结构 / subTasks 兜底** | `composite-routing.ts` | 无 plan 时：`subTasks≥2` 或 **多问结构**（≥2 问号等）→ 按子句拆 plan；单问 → **Intake `queryType` + canonical 模板**（`identity` / `enumeration`） |
| **enumeration 分流** | `enumeration-target.ts` + `composite-slot-queries.ts` | plan 项 label/topics → **`project` \| `experience`**；canonical → `PROJECTS_SLOT` / `EMPLOYERS_SLOT`（label 优先纠正误标 topics） |
| **KM 分槽** | `composite-slot-queries.ts` + `composite/slots-parallel.ts` | **按需子集**槽；experience 列举 vs **projects 列举** 分路检索 + fill；检索 hits 缓存 key 仍为 `searchQuery+queryType` |
| **单问/多问对齐** | `query-signals.ts` + `intake-link-lookup-guard.ts`（P0-25） | LLM plan/subTasks 与**当前问句结构**不一致时：**无并列结构 + plan≥2** → **收束单槽**；**编号/多问结构** → **展开多槽**；只用结构信号，不用意图词表 |

**路由结论（2026-07 修订 · 单问/多问合并）：** 凡 `retrieve_and_answer` 一律 **`routeMode=slots`**，`compositeSlots.length` 为 **1～N**（不再区分 `single` / `slot` / `composite` 三种 routeMode）。0 槽时 `decisionToRetrievalSlot` 包装为 **1 槽**。Analyst / KM 按 **槽数** 分支：1 槽走单段流式；≥2 槽走 composite 顺序流式。`routeReason` / `routePlanSource` 可观测 plan 来源。

**单问 ↔ 多问对齐规则（结构层，非词表）：**

| 当前问句结构 | LLM plan/subTasks | guard 行为 | 典型场景 |
|--------------|-------------------|------------|----------|
| **无**显式并列（单句、无 ≥2 编号行） | plan≥2 或 subTasks≥2 | **收束为 1 槽**（清空 retrievalPlan，canonical 聚合 searchQuery） | 泛化「开源两个项目 github」+ 会话 inherited 物联网/工具库 plan（P0-25） |
| **有**显式并列（≥2 编号行 / ≥2 问号） | plan 空或不足 | **展开多槽**（retrievalPlan guard 补 plan；link guard 按编号拆 entity 槽） | 「1. 物联网… 2. 工具库…」各查各的 GitHub |
| 单问 | plan 空、subTasks≤1 | **1 槽** `slots_default` 或 queryType 模板槽 | 「城管平台用了什么技术」 |

实现：`hasExplicitMultipartStructure` / `hasStaleMultipartFromDecision`（`query-signals.ts`）；external_link 收束/展开在 `applyIntakeLinkLookupGuard`；⑤ retrievalPlan guard 负责**多问补 plan**（只扩不随意收束，收束在 link guard 等 profile 专用 guard）。

**Analyst：** composite ≥2 子问 → **顺序 plain-text 流式**（`stream-composite.ts`）；单问 identity/enumeration/default 同路径（**P0-19**）；`tech` 仍 JSON。子问 **topics=project** 时只列 projects/ 文档（**P0-21**）。hits 上限见 `analyst-recall-limits.ts`（**P0-20**）。

**会话 cache（D5-2 扩展 · 2026-06）：**

| 机制 | 模块 | 职责 |
|------|------|------|
| **同问短路** | `prepare-turn-start/repeat-question-guard.ts` | 同会话**字面相同**问 → 复用 history 整答；`REPEAT_QUESTION_CACHE_DISABLED=1` 关闭 |
| **检索结果 cache** | `retrieval-cache.ts` | 单槽 KM 结果 cache（`searchQuery+queryType`）；`RETRIEVAL_CACHE_DISABLED=1` 关闭 |
| **composite 终稿 cache** | `composite-answer-cache.ts` + `stream-composite.ts` / `runtime/stream.ts` | 同 `conversationId` + `corpusUserId` 下按 **facetKey** 缓存子问终稿；slot 单槽命中时 `knowledge-manager/nodes/`、`knowledge-manager/pipeline/` 从 citations 还原 hits |
| **增量 composite** | `knowledge-manager/composite/incremental-plan.ts` | Q2 = Q1 + 邮箱/电话：**终稿 cache 命中槽跳过真检索**，仅对新 facet 检索/流式；「全部重来」→ `clearCompositeSession` |

**环境变量：** 见 `.env.example` 中 **Pipeline cache 开关**；未配 Redis 时检索/composite cache 用 memory fallback（清 cache 须重启 agents）。

**本地开发注意：** 若在 `.env` 设 `REPEAT_QUESTION_CACHE_DISABLED=1` 或 `RETRIEVAL_CACHE_DISABLED=1` 以便调试全链路，**verify / eval 脚本**会通过 `scripts/verify-test-env.ts` 在运行时临时覆盖为开启（不影响已加载的 `--env-file` 其它变量）。生产 / Web 仍读 `.env` 原值。

**验证：**

```bash
pnpm --filter @fambrain/brain-service run verify:composite-route       # 路由/merge/Intake identity 单槽
pnpm --filter @fambrain/brain-service run verify:composite-incremental # composite 终稿 cache
pnpm --filter @fambrain/brain-service run verify:r6-no-cache           # P0-15 + R6-1/2/3 全链路（三层 cache 全关，11 项）
pnpm --filter @fambrain/brain-service exec tsx --env-file=../../.env scripts/diagnose-age-query.ts
pnpm --filter @fambrain/brain-service exec tsx --env-file=../../.env scripts/clear-pipeline-cache.ts
```

Web：Q1 综合履历 → Q2 加邮箱/电话应见 `compositeFacetCacheHits > 0`；单问「今年多大」见 **§2.5.4**（P0-18 ✅）。**R6 / P0-15 回归**优先跑 `verify:r6-no-cache`（排除 cache 干扰）。

#### 2.5.4 单问年龄 + 多轮 cache（✅ P0-18 · 2026-06）

**原现象（三类，同属「年龄单问 + cache 链路」）：**

| 现象 | 根因 | 对策 | 状态 |
|------|------|------|------|
| 「我今年多大了」→ Intake `clarify` | LLM 见 Mem0 仅工作年限、误判信息不足 | Intake prompt **示例 9**：档案/年龄单问禁止 clarify，须 `retrieve_and_answer` + identity | ✅ |
| 槽答案缓存命中 + 单槽 →「未标注年龄」 | 槽答案缓存跳过 KM，`merge.hits` 空 → `rules_empty_hits_skip_llm` | `knowledge-manager/composite/retrieve.ts`：citations→hits；`runtime/stream.ts` 单槽槽答案直出 | ✅ |
| 同句再问 1ms 复用错误兜底 | 同问短路复用 history 中 insufficient 答 | `REPEAT_QUESTION_CACHE_DISABLED=1` 可关；清 cache + 重启 agents | ✅ |

**改动摘要：** `5c4f89b` — Intake 示例 9；槽答案缓存+slot Analyst 路径；`REPEAT_QUESTION_CACHE_DISABLED` / 检索 hits 缓存 / 槽答案缓存 env 开关；`clear-pipeline-cache.ts`、`diagnose-age-query.ts`。路由以 Intake `retrievalPlan` / `queryType` 为主（**无**问句 regex guard）。

**验证：**

```bash
pnpm --filter @fambrain/brain-service exec tsx --env-file=../../.env scripts/diagnose-age-query.ts
pnpm --filter @fambrain/brain-service run verify:composite-route
pnpm --filter @fambrain/brain-service run verify:composite-incremental
```

Web：「我今年多大了」→ `routeMode=slots`（1 槽），KM hits 含 `出生日期 | 1993.03`，Analyst 经 **`compute_age_from_hits`** 输出周岁（如 `33 岁（简历记载生于 1993 年 3 月）`），非 clarify、非「可推算」复述。详见 **§2.5.7**（P0-23）。

#### 2.5.5 Analyst 纯文本流 + enumeration 项目/公司分流（✅ P0-19 / P0-20 / P0-21 · 2026-06）

**背景（Web 综合履历联调）：**

| 现象 | 用户体感 | 坑 ID |
|------|----------|-------|
| 单问「在哪几家公司…」答成「根据知识库摘录」+ Markdown 表格粘贴 | 像 thinking/内部结果，非正式回答 | **P0-19** |
| 综合问「4. 具体项目名称」列出 **云联智慧、友谊时光**（公司+职位） | 问项目答公司 | **P0-21** |
| 综合问公司段只列 2/4 家；子问再问格式正常 | 一问多答时 enumeration 被压缩 | **P0-20** |

**根因（架构）：**

| 层 | 问题 | 说明 |
|----|------|------|
| **Analyst 双路径** | composite 子问 plain-text；单问 JSON+think | JSON 解析失败 → 旧 `buildFallbackAnswer` 粘贴 excerpt |
| **hits 上限不一致** | 子问 cap **4**、Organizer cap **5**；KM enumeration **8** | 上游召回够、下游 Analyst 只见 subset |
| **enumeration 未二分** | KM 凡 enumeration 即 **experience fill** | plan label「项目名称」+ 误标 topics 仍走 employers 槽 |

**对策（已实现 · 不靠整句 userQuestion regex guard）：**

| 模块 | 改动 |
|------|------|
| `analyst-recall-limits.ts` | `maxAnalystHitsForProfile()`；`prefersPlainTextAnalystStream()` |
| `stream.ts` | 单问 identity/enumeration/default → `streamAnalyzeSubQuestion`；tech 仍 JSON |
| `analyze-helpers.ts` | `formatHitsAsAnswerList`；fallback 无「根据知识库摘录」 |
| `organize-knowledge.ts` | `queryProfile` → `organizeHits(maxHits)` |
| `enumeration-target.ts` | `resolveEnumerationTarget`：**plan label 优先于 topics** |
| `retrieve.ts` | `ensureEnumerationProjectCandidates` + `applyEnumerationFill(..., target)` |
| `sub-question-prompt.ts` | project topics：禁止把 experience 公司当项目名 |

**验证：**

```bash
pnpm --filter @fambrain/brain-service run verify:analyst-empty-hits   # P0-19 fallback 形态
pnpm --filter @fambrain/brain-service run verify:composite-route      # P0-21 label「具体项目名称」→ projects 槽
pnpm --filter @fambrain/brain-service run verify:r6-no-cache          # 回归 R6 / P0-15
pnpm --filter @fambrain/brain-service run verify:enumeration-compose  # P0-22 列举 blocks
```

#### 2.5.6 综合问项目列举 + 分页（✅ P0-22 · 2026-07）

**现象 A：** 综合问「姓名 + 年龄 + **全部项目**」时，语料 `projects/` 有 **36** 个 md，回答里项目段只有 **2** 条（如 agents-monorepo、my-mini-react）。

**现象 B：** 单问「列出全部项目」只出 20 条，用户误以为检索不全；列表带 `#`/`>`/长 excerpt，难以阅读。

**根因链 A（实测 `diagnose-projects-query.ts`）：**

| 层 | 问题 | 说明 |
|----|------|------|
| **KM** | `PROFILE_MAX_HITS.enumeration=8` | 单次 hybrid 最多 8 条；36 项不可能一次全进 hits |
| **ContentOrganizer** | `parseKnowledgeHits.max(5)` + `organizeHits` 忽略 `maxHits` | 8 条被截成 **5**（已修） |
| **Analyst LLM** | composite 项目子问仍调 LLM 摘要 | 5 条常被压成 **2** 条（P0-20 同类） |

**产品策略（三档，均为有意设计）：**

| 场景 | 路径 | 条数 / 页 |
|------|------|-----------|
| composite 内「项目段」 | hybrid KM + fill | **预览 8**，序号 1–8 |
| 单问「列出全部 / 都列出来」 | `list-corpus-entries` 分页 API | **每页 20**（如 36 项 → 2 页） |
| 续问「更多项目」 | 读 `enumeration-list-session` → 下一页 | 序号连续（如 21–36） |

**对策（已实现）：**

| 模块 | 改动 |
|------|------|
| `compose-message.ts` | **enumeration 确定性 Composer**：blocks + actions |
| `enumeration-format.ts` | **序号 + 仅项目名**；`formatEnumerationPaginationHint()` 分页文案 |
| `analyze-helpers.ts` | `shouldSkipSubQuestionLlm`：enumeration / identity 年龄 → **编排工具** skip LLM |
| `contract/schema.ts` + `organize-hits.ts` | profile 感知 cap（enumeration **8**；分页时 `maxHitsOverride=pageSize`） |
| `retrieve.ts` | `enumerationMeta`（total / page / hasMore） |
| `list-corpus-entries.ts` + `/enumeration/list` | **分页 API**（path 排序 slice，不经 hybrid） |
| `enumeration-list-intent.ts` → **`applyEnumerationSlotGuard`** | ~~口语 regex 猜续问~~ → **per-slot** `enumerationControl` + `executor=list_corpus`（见 **§2.5.10**） |
| `enumeration-action-prompts.ts` | UI 按钮 **精确 prompt** → Intake 短路，不依赖 regex |
| `enumeration-list-session.ts` | 会话记住 listKind / lastPage |
| `composite-answer-cache` | 槽答案缓存 **存 blocks**，命中恢复表格 UI |
| `packages/brain-types` | `AssistantMessageBlock` + `paginationHint` / `startIndex` |
| `assistant-message-content.tsx` | 表格 **# + 项目名称**；底部分页说明 |
| `chat-shell.tsx` | 续问按钮 → **自动 send**（非仅填 draft） |

**分页文案示例（纯文本 footer 与 Web `paginationHint` 一致）：**

- 预览：`语料共 36 个项目 · 本节预览 8 个，序号 1–8 · 发送「列出全部项目」可分页浏览完整列表，每页 20 条，共 2 页`
- 第 1 页穷举：`语料共 36 个项目 · 第 1/2 页 · 序号 1–20 · 发送「更多项目」查看下一页`
- 最后一页：`… 第 2/2 页 · 序号 21–36 · 已全部列出`

**验证：**

```bash
FAMBRAIN_CORPUS_USER_ID=cmp9ihokn00000mbmhwh6gn0b \
  pnpm --filter @fambrain/brain-service exec tsx --env-file=../../.env scripts/diagnose-projects-query.ts
pnpm --filter @fambrain/brain-service run verify:enumeration-compose
pnpm --filter @fambrain/brain-service run verify:enumeration-pagination
```

#### 2.5.7 identity 年龄编排工具（✅ P0-23 · 架构升级 P0-24 · 2026-07）

**现象：** 单问「我今年多大 / 年龄多大」时，KM 已命中 personal 简历，excerpt 含 `| 出生日期 | 1993.03 |`，但 Analyst LLM 只答「简历记载出生日期为 1993.03，可以推算年龄」——**不给具体岁数**，用户体感像「没答」。

**根因链：**

| 层 | 问题 | 说明 |
|----|------|------|
| **Analyst prompt** | P0-15/18 明确 **禁止 LLM 按当前年份推算年龄** | 防幻觉正确，但未配确定性 age 路径 |
| **Pipeline** | 未向 Analyst 注入 **asOfDate** | LLM 即使想算也缺基准日 |
| **架构缺口（P0-23）** | enumeration 已有 skip-LLM composer；**identity 年龄写在 Analyst 内联** | composite 年龄槽走 `resolveOrchestratedTool`，非独立编排节点 |

**P0-24 架构升级（四类数据源）：**

| 工具 ID | 用途 | 接入（新） |
|---------|------|------------|
| `compose_enumeration` | 项目/公司列举 + blocks | `ToolOrchestrator` → `toolResults.enumeration` |
| `compute_age_from_hits` | excerpt 提取出生 → **服务端周岁** | `ToolOrchestrator` → `toolResults.age`；`asOfDate` 由 `prepareTurnStart` 注入 |
| `search_web` | 外部事实（Tavily） | `primaryDataSource=web` 或语料弱命中；需 `TAVILY_API_KEY` |
| `synthesize_merge` | 混合 DAG 汇合 | `DagExecutor` → `toolResults.synthesis` |

**代码：** `agentflow/agents/online/tool-orchestrator/*` · `pipeline/graph/compile.ts`（`dagExecutor` / `toolOrchestrator` 节点）· `field-catalog.ts` · `tools/search-web.ts` · Analyst 读 `pickToolResultForSubQuestion`。

**验证：**

```bash
pnpm --filter @fambrain/brain-service run verify:tool-orchestration
pnpm --filter @fambrain/brain-service run verify:dag-hybrid
pnpm --filter @fambrain/brain-service run verify:orchestrated-identity
pnpm --filter @fambrain/brain-service exec tsx --env-file=../../.env scripts/diagnose-age-query.ts
pnpm --filter @fambrain/brain-service run verify:langchain-tools
```

**日志：** ToolOrchestrator 完成时 `keys=[age|enumeration|web|slot_*]`；Analyst skip 时 `source=orchestrated_compute_age_from_hits` 或 `toolResults`。

详见 [架构 v2 文档](./05-architecture-v2-tool-orchestration.md)。

#### 2.5.9 简历 GitHub / 对外链接问法（✅ P0-25 · 2026-07）

**现象（Web 会话 · 语料 `2024-独立开源探索` 段）：**

| 轮次 | 用户问 | 实际回答 | 与预期 |
|------|--------|----------|--------|
| 1 | 开源项目的 GitHub 地址 / 链接 | 物联网模板、工具库等 **aky 内部 offline 路径** | 简历对外开源仅 **Sentinel + release-bot** 两条 `github.com` URL |
| 2 | 应有两条，只给了 release-bot | 漏 **sentinel-monorepo** | 语料 `personal/个人简历-潘展飞.md`、`sentinel.md`、`release-bot.md` 含 URL；`aky-*` 文档 **无** github.com |
| 3 | 「不止这一个」 | **clarify** 追问 | 省略续问应 **继续检索**，非澄清 |
| 4 | 点名「物联网模板归档 + 工具库草稿」 | 一「未覆盖」、一 **错绑 release-bot** | 两项目为 **公司 offline 草稿**，非简历开源仓库；Analyst 不应跨槽借 URL |

**根因链：**

| 层 | 问题 | 说明 |
|----|------|------|
| **Intake LLM** | 「GitHub / 开源链接」误标 **`queryType: enumeration`** | 走 projects 列举 fill → `projects/aky-*` 占满 hits，**personal 简历对外链接段**被挤出 |
| **Intake 会话** | 前轮 composite **subTasks**（物联网 / 工具库）**污染**本轮 generic「两个开源 github」 | LLM 继承 stale plan → 多槽 external_link 指向错误实体 |
| **Intake guard** | 「不止这一个」等 **短省略句** 在 clarify 早退之前未纠正 | 用户续问被当成信息不足 |
| **query-signals** | 若在 guard 里堆 **github/开源/模板** 等 regex 词表 | 与「意图由 Intake LLM 负责」原则冲突，且难维护 |
| **KM** | enumeration profile 的 **projects fill** 不区分「要 URL」与「要项目名** | external_link 需 **personal 简历 + 含 URL 行** 加权；`pickExcerpt` 优先 URL 行 |
| **Analyst** | 命中项目文档但 **无公开链接** 时，从其它槽 **借 release-bot URL** | external_link 子问须：**只输出 hits 内 URL**；找到项目无 URL → 明确「语料无公开链接」，禁止跨项目串链 |

**语料事实（诊断脚本核对）：** 该用户 corpus 中 **仅 2 条** 公开 GitHub URL（`sentinel-monorepo`、`release-bot`）；`aky-iotgeneraltemplate.md`、`aky-deno-mylib.md`、`2024-独立开源探索.md` **不含** github.com。

**对策（已实现 · 不靠项目名/URL 硬编码）：**

| 优先级 | 对策 | 改动面 |
|--------|------|--------|
| P0 | Intake 新增 **`queryType: external_link`**（prompt + schema）；GitHub/仓库/URL 问法 **禁止** enumeration | `contract/prompt.ts`、`schema.ts` |
| P0 | **`applyIntakeLinkLookupGuard`**：仅当 LLM 已标 `external_link` 时运行；**stale multipart**（plan≥2 但当前问句无并列结构）→ 单槽 **`EXTERNAL_LINK_SLOT`**；编号 `1.` `2.` 行 → 按实体分槽 | `guards/intake-link-lookup-guard.ts`、`composite/composite-slot-queries.ts` |
| P0（列举分页重构 · 2026-07） | 去掉口语 regex；**per-slot** `enumerationControl` + `executor=list_corpus\|km_retrieve`；混合问 tech+穷举 同轮分槽；UI 按钮仅 exact-match `ENUMERATION_ACTION_PROMPTS` | `enumeration-action-prompts.ts`、`applyEnumerationSlotGuard`、`retrieval-node` 按槽执行（详见 **§2.5.10**） |
| P0 | **`applyIntakeContinuationGuard`**：短句 + 历史含 `https://` → **retrieve**，在 clarify 早退 **之前** | `guards/intake-continuation-guard.ts` |
| P0 | **`query-signals.ts` 仅结构工具**（编号行、multipart、短句长度）；**不**维护意图 regex 词表；`decisionRequestsExternalLink()` 读 LLM `queryType` | `query-signals.ts` |
| P0 | **单问/多问结构对齐**：`hasStaleMultipartFromDecision` — LLM 多槽 plan 但当前问句无并列结构 → **收束 1 槽**；`hasExplicitMultipartStructure` + 编号行 → **展开 N 槽** | 同上 + link guard |
| P0 | KM **`external_link` profile** + **`applyExternalLinkGuard`**（personal 简历、含 URL 文档 boost） | `km-config.ts`、`query-profile.ts`、`retrieve.ts` |
| +1 | Analyst **`external_link`** 子问 prompt：只列 hits 内 URL；无 URL 则说明无公开链接 | `information-analyst/sub-question-prompt.ts` |

**Guard 链顺序（Intake pipeline）：** parse → **continuation** → clarify 早退 → chitchat → userFact 早退 → **link lookup**（含 stale multipart **收束** / 编号 **展开**）→ retrievalPlan（多问 **补 plan**）→ composite（**slots 1～N**）→ **`applyEnumerationSlotGuard`**（per-slot 列举 executor · P0-26）。详见 [02-agent-flows §2](./02-agent-flows.md#2-intakecoordinator--入口接线员-)、[§2.5.3 单问/多问合并](./04-pitfalls.md#253-p0-15--r6-3--composite-分槽检索-2026-06)、[§2.5.10 列举 per-slot](./04-pitfalls.md#2510-列举执行-per-slot-架构升级-p0-26--2026-07)。

**验证：**

```bash
pnpm --filter @fambrain/brain-service run verify:intake-link-lookup
pnpm --filter @fambrain/brain-service run verify:intake-coreference   # 续问 guard 回归
pnpm --filter @fambrain/brain-service exec tsx --env-file=../../.env scripts/diagnose-github-opensource-query.ts
```

**日志：** `guard_续问指代`（continuation）；`guard_对外链接`（link lookup reason）；composite 槽 `queryType=external_link`。

#### 2.5.10 列举执行 per-slot 架构升级（✅ P0-26 · 2026-07）

> **背景：** P0-22 落地列举分页后，穷举路径仍用 **整句 `routeMode=list`** + `enumeration-list-intent.ts` **口语 regex**（「更多项目」「都列出来」等）。与 P0-15 已确立的 **composite 多槽**、P0-25 的 **按槽 queryType** 方向冲突，混合问句无法同轮分槽执行。

**现象：**

| 场景 | 用户问 | 实际行为 | 与预期 |
|------|--------|----------|--------|
| **混合问** | 「我的 React 技能 + **列出全部项目**」 | 整句被 **list 模式** 劫持，只跑 list API | tech 段应走 **KM hybrid**，项目段应 **list_corpus 分页** |
| **续问** | 「更多项目」 | regex 词表命中则短路 Intake | 口语变体易 **漏判 / 误判**；与「意图由 Intake LLM 负责」矛盾 |
| **UI 按钮** | 点击「列出全部项目」 | 有时仍走 LLM，prompt 与口语 regex 不一致 | 应 **精确 prompt** 短路 |

**根因链：**

| 层 | 问题 | 说明 |
|----|------|------|
| **路由模型** | **`routeMode=list` 是整句级** | 一条用户消息只能选一种执行模式；无法「一槽 KM、一槽 list」 |
| **Guard 实现** | `enumeration-list-intent` **堆口语 regex** | 维护成本高；与 P0-25「guard 只做结构、不做意图词表」原则冲突 |
| **KM** | `retrieval-node` **无 per-slot executor** | 列举穷举与 hybrid 检索互斥分支，不能同轮并行 |
| **Intake 契约** | plan item 无 **`enumerationControl`** | LLM 无法声明 preview / continue / exhaustive；guard 只能事后猜 |

**为什么要改架构（而非再加 regex）：**

1. **产品已承诺 composite 分槽**（P0-15/R6）：执行层必须 **按槽** 而非按整句。
2. **列举三档**（预览 8 / 分页 20 / 续页）是 **槽级策略**，不应提升为全局 routeMode。
3. **UI 按钮** 与 **口语续问** 应走同一条契约（`enumerationControl`），而不是两套入口。

**对策（已实现）：**

| 模块 | 改动 |
|------|------|
| `contract/schema.ts` | plan item 新增 **`enumerationControl`**（`action`: preview \| continue \| exhaustive + `listKind`） |
| `composite/interface.ts` | slot 新增 **`executor`**: `km_retrieve` \| `list_corpus` |
| `enumeration-action-prompts.ts` | UI 按钮 **固定 prompt**；`matchUiEnumerationPrompt()` exact-match |
| `enumeration-list-intent.ts` | 重命名为 **`applyEnumerationSlotGuard`**：按槽补 executor / 页码；**删除口语 regex 词表** |
| `intake-node.ts` | UI prompt 命中 → **跳过 Intake LLM**，直接 `buildEnumerationListDecision` |
| `retrieval-node.ts` | **按槽** 分支：`km_retrieve` → hybrid；`list_corpus` → `list-corpus-entries` 分页 |
| `tool-orchestrator` | 列举 **compose** 仍走 `compose_enumeration`；取数与 KM/list 分离 |
| 路由 | **`routeMode=list` 废弃**；穷举一律 **`routeMode=slots`** + N 槽 |

**链路（通俗）：** Intake 给每个子问题贴「预览 / 翻页 / 穷举」标签并指定「去 KM 还是 list API」→ retrieval **按槽** 分别取数 → ToolOrchestrator 把列举块合成 → Analyst 只写稿。

**验证：**

```bash
pnpm --filter @fambrain/brain-service run verify:enumeration-pagination   # 含混合 2 槽
pnpm --filter @fambrain/brain-service run verify:enumeration-compose
pnpm --filter @fambrain/brain-service run verify:composite-route
```

详见 [架构 v2 §10](./05-architecture-v2-tool-orchestration.md#10-列举执行-per-slot-演进-2026-07)。

#### 2.5.8 Golden 回归 G1～GMem（✅ 2026-06）

**命令：**

```bash
cd apps/brain-service
GOLDEN_RUNS=3 pnpm run golden:regression
```

**覆盖：** G1 闲聊 · G2 姓名 · G3 项目技术 · G4 城管 · G5 无上下文 clarify · G5b 多轮指代 · **GMem** 跨会话 QQ。

**验收：** 2026-06 连跑 3 遍 → **7/7×3** 全通过。

| 坑 | 现象 | 根因 | 对策 |
|----|------|------|------|
| **G1** | 「你好」→ 走 retrieval，答「知识库未覆盖」 | P0-16 后 schema 要求 `userFactKey` 等；LLM 未输出 → **Zod parse 失败** → `defaultIntakeDecision("你好")` | `schema.ts`：`userFact*` 缺省 `preprocess → null`；`verify:agent-schemas` chitchat 无 userFact 字段用例 |
| **G5b** | 上文城管平台，「那个项目呢？」答 E-HR 等无关项目 | Intake searchQuery 未补全上文实体 | **`prompt.ts` 多轮指代补全**（LLM 显式写实体）；Golden 断言须含城管/React 等；eval **`answerMustNotRe`** 在 **`answerRe` 已匹配**时不误杀含「指的是」的合理解析答（`assert-golden.ts`） |
| **GMem** | — | — | **`golden:regression`** `runCrossSessionMemCase` + **`eval:run`** `memProbe`（conv A remember → conv B recall） |

**Eval 与 Golden 对齐：** GMem 在 `golden-regression.ts` 为第 7 项；`golden.json` **memProbe** 由 `eval:run` 读取（`--mem-only` 快速单测）。二者测同一 P0-16 场景。

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

#### 根因分析（2026-06 已验证）

| 层级 | 根因 | 说明 |
|------|------|------|
| **LangMem** | 按 `conversationId` 隔离 | 对话 B **不会**读到对话 A 的会话摘要；跨会话只能靠 Mem0 |
| **Mem0 写入** | 轮次结束 `addTurnToMem0` 依赖 LLM **抽取**事实 | 「记住 QQ」可能未抽成结构化记忆；**对策：** userFact 节点 **显式** `addStructuredUserFact` |
| **Mem0 检索** | 语义 search 返回自然语言行如 `QQ号是734858469` | 旧 `extractLooseValueAfterLabel` 把标签 `QQ号` 只匹配前缀 → 误提取 **「码」**；**对策：** `extractByFactKey` + `validateFactValueForKey` |
| **Analyst / Intake** | 问 QQ 走 **| **部署** | agents 未重启 | 改 `user-fact.ts` 后仍跑旧进程 → Web 仍见旧 bug |

**链路（通俗）：** 对话 1 结束时系统「尝试」把整轮对话塞进长期记忆抽屉 → 抽屉里可能没有单独一张「QQ」标签 → 对话 2 问 QQ 时抽屉搜不到 → 又去书架上找（语料）也没有 → 只能说不知道。

#### 对策（计划 · Day 3 + D8）

| 优先级 | 对策 | 改动面 |
|--------|------|--------|
| P0 | Intake 识别 **remember_fact** / **update_profile**（「记住」「我的 QQ 是」）→ 结构化写入 Mem0（键值或单条 memory），不只靠轮次后抽取 | `intake-coordinator`、`mem0/store.ts` |
| P0 | 联系方式 / 账号类 query：**Mem0 search 优先**；corpus hits 空时仍可用 Mem0 作答，与「履历类 hits 空禁用 Mem0」分流 | `information-analyst` prompt、`prepare-context.ts` |
| P0 | `persistPipelineMemory` 失败 **打 agent-log / 不吞错** | `agents/online/persist-turn-end/` |
| P1 | Golden **G-跨会话记忆** | `golden-regression.ts` GMem | ✅ 2026-06 |
| P2 | 用户确认「写入语料」时追加 `corpus/personal/` 并触发增量 index | 产品化；非 P0 |

**实现（2026-06 · P0-16 ✅）：**

1. Intake 输出 **remember_user_fact / recall_user_fact** + **userFactKey/Label/Value**（模型命名字段，无问句 regex 词表）
2. **userFact 节点**（`compile.ts`）→ Mem0 `addStructuredUserFact` / `searchUserFactMemories`
3. 召回值提取：`extractByFactKey(qq)`、`validateFactValueForKey`；Mem0 行 `QQ号是734858469` + label `QQ号` → **734858469**（非「码」）
4. `verify:user-fact` 跨 conversationId 验收；Web 复测须 **重启 agents**

**验证：**

```bash
pnpm --filter @fambrain/brain-service run verify:user-fact
```

Web：对话 A「我的qq是734858469」→ 确认；**新建**对话 B「我的qq是多少」→ `您记录的QQ号是 734858469。`

**临时 workaround（非主路径）：** 将 QQ 写入 `data/doc/users/<corpusUserId>/corpus/personal/` 对应 md → `pnpm run index:corpus`。

### 2.7 同会话综合履历问 vs 编号子问 — 答案退化（✅ 2026-06 · `verify:r6-no-cache`）

> **背景：** 同一对话内，用户用**一条综合问**得到完整正确履历；随后**重复问 / 改成编号子问**后，公司数从 **4 家降为 2 家**，且与首轮结论矛盾。耗时约 **42.6s**（`totalMs`），说明仍走全链路检索 + 生成，非 cache 简答路径。

#### 标准问法（用户原文，可入 Golden）

```text
我叫什么 ，我做过什么项目，我在那几家公司上过班，近两年在干什么？
```

编号子问变体（同会话第 3 轮）：

```text
1.我做过哪些项目？
2.我在那些公司上过班
3.近两年我在干什么？
4.我叫什么
```

#### 现象摘要

| 轮次 | 用户问 | 实际回答（摘要） | 与预期 |
|------|--------|------------------|--------|
| 1 | 综合问（姓名+项目+公司+近两年） | **潘展飞**；**4 家**公司（苏州云联智慧、友谊时光、苏州奖多多、西安奥卡云）+ 起止时间与职位；项目含 E-HR、微前端、城管平台等；2024.10 起独立开源 | ✅ 与语料一致 |
| 2 | 综合问 + 「我近两年在干什么？」重复 | **潘展飞**；侧重奥卡云（2021.06–2024.09）+ 2024.10 起开源；未再完整列 4 家 | 🔄 部分正确，枚举弱化 |
| 3 | **1～4 编号子问**（同会话） | 称「**两家公司**」：仅 **西安奥卡云**、**苏州奖多多**；项目仅 **城市管理平台**、**E-HR** | ❌ 缺苏州云联、友谊时光；与第 1 轮 **4 家** 矛盾 |

**语料 ground truth（潘展飞）：** 工作经历应含 **4 段公司**（见 `experience/` 与 `personal/个人简历-潘展飞.md`）；不应在已有完整首轮回答后「降级」为 2 家。

#### 与 R6-1 / R6-2 / P0-15 的关系

| | R6-1 | R6-2 | R6-3（本节） | P0-15 |
|--|------|------|--------------|-------|
| 触发 | 单问「哪几家公司」 | 表格/格式化追问 | **综合问已对 → 编号/重复问变差** | 复合问幻觉/波动 |
| 主要问题 | 枚举不全 | 跨轮否定已确认事实 | **同会话答案不一致（4→2）** | 编造他人 / hits 弱 |
| 用户体感 | 「怎么少了几家？」 | 「刚才还说有，现在说没有？」 | 「第一遍对了，换种问法反而错？」 | 「同问有时赵一有时潘展飞」 |

#### 根因分析（待 agent-log 验证）

| 层级 | 根因 | 说明 |
|------|------|------|
| **Intake** | 编号「1～4」可能被当成**新检索任务**，未绑定为**同一 composite profile**；`searchQuery` / `queryType` 与首轮不一致 | 子问 2 仅触发「公司」子集检索，未继承首轮 `subTasks` |
| **KM** | 与 §2.3 相同：`MAX_HITS` + 向量 topK → **列举型/多公司**仍只拉回 2 个 experience chunk | 子问形态下 Intake 的 `topics` 可能偏 `project` 而非 `enumeration` |
| **Analyst** | 当轮 hits 仅含奥卡云、奖多多相关 chunk 时，**正确但保守**地只答 2 家；**未读**本会话首轮 assistant 已 grounded 的 4 家列表 | 与 R6-2 类似：缺「同会话 grounded 不可降级」 |
| **D5-2 / cache** | 第 3 轮未命中「同 composite 问」cache（问法已变）；仍全量 KM+FC | **同问短路（2026-06-18）** 已覆盖「字面相同综合问重复」；换形子问仍走全链路 |
| **可观测** | 本轮 `latencyMs≈42600`，非重复问快路径 | 同问短路命中时仅 **`prepare_turn_start`** step、`repeatQuestionHit=true`、~ms 级 |

**链路（通俗）：** 第一轮问得宽，检索凑齐 4 段经历 → 答对 → 用户改成四条小题 → 系统每题重新找书 → 第二题「哪些公司」只找到 2 本书 → 分析师只念 2 家，**忘了第一轮已经列过 4 家**。

#### 对策（计划 · 并入消坑 R6 + P0-15）

| 优先级 | 对策 | 改动面 |
|--------|------|--------|
| P0 | Intake 识别 **profile_composite** / **numbered_subtasks**：1～4 子问映射到固定 `subTasks`（identity / projects / employers_enumeration / recent_two_years），**同一 `searchQuery` 骨架** | `intake-coordinator` prompt、`query-profile.ts` |
| P0 | 同会话已有 **grounded 4 家** 时，Analyst **不得**在后续轮次输出更少公司数（除非明确标注「本轮 hits 仅补充」） | `information-analyst` prompt、可选 state `priorGroundedFacts` |
| P0 | 与 R6-1 合并：**enumeration** queryType → KM 按 `experience/` path **穷举** | `retrieve.ts`、KM-13～15 |
| +1 | Golden **`G-履历综合` profileProbe**：4 轮（综合问 → 同问短路 → 列举 → **编号「1. 我在哪几家公司…」**）→ 公司 **恒为 4** | `golden.json` / `eval:run --profile-only` ✅ |
| +1 | agent-log 断言：轮 3/4 `hitCount` / `hitPaths` 覆盖 `experience/` 文件数 ≥ 4 | eval 报告 |

**验证（2026-06 通过）：**

```bash
pnpm --filter @fambrain/brain-service run eval:run -- --profile-only   # G-履历综合 t1～t4（cache 开，t2 期望同问短路）
pnpm --filter @fambrain/brain-service run verify:r6-no-cache           # 同会话 4 轮 + 编号子问（cache 全关，11/11）
```

`verify:r6-no-cache` 覆盖：综合履历 → 同句再问 → 单问枚举 → **「1. 我在哪几家公司…」** 均 **4 家**。

### 2.2 FactChecker 与跨轮重复检索（2026-06 · D5 联调）

> **背景：** D5 已接入 `Intake → KM → FactChecker → Analyst`。FactChecker 职责是 **检索后、生成前** 审查当轮 `hits`/`coverage`，不是「验完永久放行」；市面同类为 Self-RAG / Corrective RAG 的 **evidence grader**，跨轮去重靠 **cache / Intake**，不靠 FactChecker 记状态。

#### 何时会进入 FactChecker（代码：`pipeline/graph/compile.ts`）

| 条件 | 路径 |
|------|------|
| `| 闲聊 / clarify / `briefReply` 提前结束 | **不进**（`respondEarly`） |
| `
**同轮第二次 FactChecker：** 仅当第一次 `passed=false` 且 `retryCount < 1` → 改写 `searchQuery` 再检索 → **必须再审新一轮 hits**（不是 bug）。

**新一轮用户消息（即使用户字面上重复上一问）：** 默认整图重跑；**同问短路**（LangGraph **`prepareTurnStart` 节点** / `repeat-question-guard.ts`）若 `normalize(userQuestion)` 与本会话 history 中某轮 user 相同且其后有 assistant 答 → **短路**，只 emit **`prepare_turn_start`** step 并流式复用上轮答案（`repeatQuestionHit`）。否则若 Intake 产出相同 `searchQuery` + `queryType` → **检索结果 cache** 跳过 KM 向量检索，仍走 FC / Analyst。

#### 典型误解 vs 实际

| 误解 | 实际 |
|------|------|
| 第一次 FactChecker 后问题应被「解决」 | 同轮只决定**本轮**证据够不够；打回 = 再检索，不是写入会话记忆 |
| 同句再问应跳过核查 | **同问短路**直接复用答案；**检索结果 cache** 命中时 FC 规则快检（`cache_hit_skip_llm`） |
| FactChecker 应避免重复读原文 | 审的是**当轮** `hits`；跨轮重复靠 cache，不靠 FactChecker |

#### 推荐对策组合（后续集中实现 · 优先级）

| 优先级 | 对策 | 解决哪类「第二次」 | 改动面 |
|--------|------|-------------------|--------|
| P0 必留 | 检索后 FactChecker + 最多 1 次打回再检索 | 同轮证据不足 | 已实现 |
| **+1** | **检索结果缓存** `corpusUserId + queryType + normalizedSearchQuery`，TTL 可配；cache hit 时 FactChecker 规则快检 | 跨轮同义再问（Intake searchQuery 稳定） | `retrievalNode` / `@fambrain/infra` ✅ |
| **+2** | **同问短路**：`normalize(userQuestion)` 与本会话 history 相同 → 复用上轮 assistant 答；`REPEAT_QUESTION_CACHE_DISABLED=1` 可关 | 跨轮 verbatim 重复 | `prepare-turn-start/repeat-question-guard.ts` + `prepareTurnStart` 节点 ✅ |
| +3 | 生成后 citation 规则校验（answer vs hits） | 幻觉终稿 | Analyst 后节点 / pitfalls #9 |
| +4 | 向量 rerank，降低 FactChecker 打回率 | 同轮少出现 2 次 FactChecker | KM |

**不建议：** 仅靠 FactChecker 跨轮记住 `passed` 跳过（语料更新、上下文变化会导致陈旧或漏检索）。

#### 踩坑表

| ID | 环节 | 现象 | 根因 | 对策（计划） | 状态 |
|----|------|------|------|--------------|------|
| D5-1 | FactChecker | 证据无命中时 UI 出现两次「核查证据…」+ 两次检索 | `routeAfterFactChecker` 打回逻辑 | 保留；用 D3-2 提高首轮命中率，减少打回 | 🔄 预期行为 |
| D5-2 | 编排 / UX | 聊天记录里**同一句再问**，仍走检索+核查 | 每轮 `runPipelineStream` 状态重置；Intake 非确定性改 searchQuery | **同问短路** ✅ + **检索结果 cache** ✅（`@fambrain/infra` + Redis）；dev `.env` 关 cache 时 verify 脚本自行 override | ✅ **已解决**（2026-06-18） |
| D5-3 | 职责 | 期望 FactChecker 校验**终稿** vs hits | 仅在生成前审证据包 | D6 后或 +3 增加生成后 groundedness | ⬜ 待做 |
| D5-4 | SSE | 重复问时 step 闪过快，用户只注意到「整理回答」 | `fact_checker` 与 `analyst` 连续 | 可选：重复问跳过 fact_checker step 展示 | ⬜ 低优 |
| D5-5 | Analyst + FC | **路径 B：** FC 二次 force_pass 后 KM 仍空 hits，Analyst 编造终稿（**P0-12**） | Analyst 无空 hits 硬兜底 | `shouldSkipAnalystLlm` + `verify:analyst-empty-hits` | ✅ **已解决**（2026-06-18） |
| D5-6 | FC + 编排 | **路径 A：** KM₁ 有 hits，FC meta `refinedSearchQuery` 导致 KM₂ 变差（**P0-17**） | LLM refined + 编排无条件覆盖 searchQuery | 见 §2.2.2：`refined-search-query.ts` + `personal_skip_llm` + `mergeRetrySearchQuery` | ✅ **已解决**（2026-06） |

**验证脚本：** `pnpm run verify:fact-checker`、`pnpm run verify:analyst-empty-hits`、`pnpm run verify:intake-chitchat`、`pnpm run verify:repeat-question-smoke`、`pnpm run verify:retrieval-cache`、`pnpm run golden:regression`（`apps/brain-service/package.json`）。

#### 2.2.1 路径 B — Analyst 空 hits 幻觉（P0-12 · ✅ 2026-06-18）

> **背景：** Golden / Web 早先联调「我的名字」时，**偶发**答「根据《个人简介》，你的名字全称为**陈明**…」；语料仅有 **潘展飞**。 hypothesized 链路：**两轮 KM 后 hits 仍空** → FC force_pass → Analyst LLM 幻觉。
>
> **与 P0-17 拆分：** 本节是 **路径 B**（KM 最终空/弱 + force_pass）；**§2.2.2 路径 A** 是 KM₁ 曾有 hits，被 FC 坏 refined 打回后 KM₂ 变差。**两条都要修，但验证与改代码顺序分开。**

**假设链路（待 agent-log 确认）：**

```text
用户「我的名字」→ Intake → KM₁ hits 空或弱
  → FC 第 1 次：打回再检索（D5-1）
  → KM₂ 仍空/弱
  → FC 第 2 次：retryCount≥1 → passed=true（force_pass_after_retry）
  → Analyst **skip LLM**（`rules_empty_hits_skip_llm`）→ insufficientEvidence 话术，不编造
```

**已实现（2026-06-18）：** `shouldSkipAnalystLlm`（`hits.length===0` 或 `coverage==="none"`）→ `buildFallbackAnswer`，日志 `source: "rules_empty_hits_skip_llm"`。

**与相关坑的分工：**

| 层级 | 坑 ID | 角色 |
|------|-------|------|
| 上游 | **D3-2** | KM 有 candidates 却 `hits:[]` |
| 中游 | **D5-1** | 同轮两次 FC 是设计 |
| 下游 | **P0-12 / D5-5** | Analyst hits 空 skip LLM ✅ |
| 易混 | **P0-17 / D5-6** | KM₁ 有 hits 却被 FC 打回 — **不是本路径** |

**典型日志（预期，待复现）：**

```text
📚 [KnowledgeManager] 📤 出去  { hitCount: 0, ... }   // KM₂ 仍空
🔍 [FactChecker] 📤 出去  { passed: true, source: rules_fallback, retryCount: 1, ... }
🧠 [InformationAnalyst] 📤 出去  { source: "rules_empty_hits_skip_llm", insufficientEvidence: true, ... }
```

**验证：** `pnpm --filter @fambrain/brain-service run verify:analyst-empty-hits`；Web 若 KM₂ `hitCount=0` 应见 `rules_empty_hits_skip_llm`，answer 不含语料外姓名。

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
| D3-9 | Analyst | 追问「那个项目呢」易 clarify 或答偏 | Analyst **不读**全量 DB 历史，仅 `userQuestion` + hits + **memoryBlock** | **Intake prompt** 指代补全 + Golden **G5b** 断言收紧 | ✅ **已缓解**（2026-06 · Golden G5b） |
| D3-10 | RAG | G3「项目+技术」hits 有但偏 `aky-*` 模板 | 向量未优先 `experience/` / `personal/` | 路径加权或 Intake topics 引导；Golden G3 断言 path 分布 | ⬜ sprint D2 |
| D3-11 | 文档 | 流程图/roadmap 仍写 LlamaIndex retriever、D3 未接 | 迁移后未同步 docs | 与代码对齐 LangChain；更新 A2 验收状态 | ⬜ sprint D4 |
| D3-12 | 开发 | `pnpm dev` agents `EADDRINUSE :3001`；需多终端起 Chroma/Redis | 旧进程占端口；依赖分散 | `scripts/dev-all.sh` 一键起 Chroma + Redis + Web + Agents；端口冲突仍需手动 kill | 🔄 **部分缓解**（2026-06-18） |

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

**落地实现（`knowledge-manager/recall/retrieve.ts`）：**

```text
searchQuery + corpusUserId
  → 向量召回: searchCorpusVectors()              // @fambrain/corpus，Chroma
  → isVectorConfident(top1, gap)?           // top1 ≤ 1.25 且 top1-top2 ≥ 0.12
      ├─ 是 → 向量 candidates
      └─ 否 / 空 → 扫盘兜底: scanDocCandidates() // 扫 experience|projects|personal
  → mergeCandidates()（低置信时合并向量 + 扫盘，按 path 去重）
  → retrieveByKeywords()                    // token 命中 + vectorScoreToRelevance
  → ensureNonEmptyHits()                    // D3-2：candidates>0 则 hits 必 ≥1
  → logAgentOut resultSource: "rule"
```

| 模块 | 常量 / 函数 | 说明 |
|------|-------------|------|
| 召回 | `MAX_CANDIDATES=12`, `MAX_HITS=5` | 与旧版一致 |
| 向量置信 | `VECTOR_CONFIDENT_TOP1_MAX=1.25`, `VECTOR_CONFIDENT_GAP_MIN=0.12` | 欧氏距离；见 `getKmRetrievalConfig()` |
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

**仍待完善（KM v3）：** 见 [km-retrieval-design.md](./km-retrieval-design.md) §三；P0-14（corpus/Mem0 矛盾）已由 KM 优化 ✅。

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
| P0-13 | #1 意图误判（chitchat briefReply 风格漂移） | ✅ `verify:intake-chitchat` |
| **P0-29** | #1 意图误判（纯问候 → retrieve） | ✅ §2.8.1 |
| **P0-28** | #2 任务拆分不合理；#4 计划漂移（多槽互斥） | ✅ §2.8 · 架构 v2 §11 |
| P0-14 | #9 信息捏造；#16 Mem0 vs corpus 同句矛盾 | ✅ KM 优化 |
| P0-15 | #9 信息捏造；#15 信息不对称 |
| P0-16 | #16 关键信息遗忘（跨 conversationId；用户自述 fact） |
| R6-1 | #3 过早终止（枚举未穷尽）；#16 跨轮不一致；P0-11 / D5-2 |
| R6-3 | #16 跨轮不一致；#12 重复输出（同会话结论自相矛盾）；R6-1 枚举未穷尽 |
| P0-21 | #9 信息捏造（项目/公司槽混淆）；enumeration 设计 |
| P0-20 | #3 过早终止（列举压缩）；#16 跨轮不一致（子集 hits） |
| P0-19 | #9 幻觉路径；UX 层「内部 excerpt 外露」 |
| P0-25 | #1 意图误判（GitHub 链接误 enumeration）；#9 跨槽 URL 错绑；#16 续问误 clarify |
| R6-2 | #16 关键信息遗忘；#17 上下文污染（当轮空 hits 否定 history）；D3-9 Analyst 不读全量历史 |

---

## 三、调试 checklist（每轮对话）

- [ ] 若出现**两次** `fact_checker` step：查 FactChecker 第一次是否 `passed=false`、是否打回再检索（D5-1，常伴 `retryCount: 1`）← §2.2
- [ ] 若**新一条消息**与上轮同句仍全链路：查 `repeatQuestionHit` 是否为 false（history 未含上轮 assistant 答，或 normalize 不一致）← §2.2

- [ ] Intake 原始 JSON 是否合理（`intent` / `searchQuery` / `- [ ] KM 预扫 `paths` 是否有内容；**`hits` 是否非空（若 `candidateCount > 0`）** ← D3-2
- [ ] KM 日志 **`resultSource` 应为 `"rule"`**（不应再出现 `"llm"`）← D3-3 / P0-4
- [ ] 预扫 paths 是否同一 md 重复过多（chunk 去重）← D3-6
- [ ] Analyst 输入里 `hits` / `coverage` 是否与 KM 一致 ← P0-6
- [ ] 终稿是否出现候选中不存在的公司、项目、日期（幻觉）
- [ ] 换模型复现：区分 prompt 问题 vs 模型能力（`OLLAMA_MODEL` / `OLLAMA_MODEL_INTAKE_COORDINATOR`）
- [ ] agents 服务 `:3001` 是否唯一实例（无 EADDRINUSE）← D3-12
- [ ] FactChecker 日志：`passed` / `refinedSearchQuery` / `retryCount` 是否符合 §2.2 判定表
- [ ] **FC 二次放行 + hitCount=0**：Analyst 应 `rules_empty_hits_skip_llm`（**P0-12** ✅）← §2.2.1
- [x] **列举型问题**（「哪几家公司」）：同句再问 answer 仍 **4 家** ← R6-1 ✅ · `verify:r6-no-cache`
- [x] **综合履历 → 编号子问**（同会话）：编号「1. 我在哪几家公司…」仍 **4 家** ← R6-3 ✅ · `verify:r6-no-cache`
- [x] **格式化追问**（「用表格列出来」）：表格追问仍保留已确认公司 ← R6-2 ✅ · `verify:r6-no-cache`
- [x] **跨会话 userFact**（A 记 QQ → B 问）：step 为 `user_fact`；answer 含完整号码；Mem0 行 `QQ号是…` 勿误提取「码」← P0-16 ✅ · `verify:user-fact`
