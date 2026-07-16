import { Annotation } from "@langchain/langgraph";
import type { AgentPipelineContext, DbChatTurn, } from "@fambrain/brain-types";
import type { AssistantMessageBlock } from "@fambrain/brain-types";
import type { RoutedIntakeDecision } from "@/agentflow/agents/online/intake-coordinator";
import type { InformationAnalystInput } from "@/agentflow/agents/online/information-analyst";
import type {
    ConfidenceTier,
    CompositeSubRetrieval,
    EnumerationMeta,
    IncrementalCompositePlan,
} from "@/agentflow/agents/online/knowledge-manager";
import type { PipelineToolResults } from "@/agentflow/agents/online/tool-orchestrator";
import type { StepResult } from "@/agentflow/agents/online/intake-coordinator/path-plan";
/**
 * LangGraph 编排共享状态（Intake → planExecutor → Compose；摘要分支 composeMode=summarize）。
 * 初始值由 `runtime/initial-state.ts` 的 `buildInitialState()` 注入；prepareTurnStart 填充 memory 字段；节点只返回需要更新的字段。
 */
export const PipelineGraphAnnotation = Annotation.Root({
    /** 本轮及历史对话轮次，供 IntakeCoordinator 理解上下文 */
    history: Annotation<DbChatTurn[]>,
    /** HTTP 层注入：登录用户、语料归属、展示名（Agent 不直接读 session） */
    context: Annotation<AgentPipelineContext>,
    /** 用户最新一条问题（从 history 提取，供检索与分析） */
    userQuestion: Annotation<string>,
    /** IntakeCoordinator 路由 JSON：pathPlan、composeMode、compositeSlots 等 */
    decision: Annotation<RoutedIntakeDecision | null>,
    /** KnowledgeManager 检索命中的文档片段，交给 InformationAnalyst */
    hits: Annotation<InformationAnalystInput["hits"]>,
    /** 检索证据是否充分：sufficient / partial / none */
    coverage: Annotation<InformationAnalystInput["coverage"]>,
    /** 知识管理员给分析师的备注；无则为 null */
    notes: Annotation<InformationAnalystInput["notes"]>,
    /** EV-04：KM 置信分档 */
    confidenceTier: Annotation<ConfidenceTier | null>,
    /** 列举分页元数据（total/page/hasMore） */
    enumerationMeta: Annotation<EnumerationMeta | null>,
    /** 澄清 / 闲聊 / briefReply 等提前结束时的终稿（不经 Analyst） */
    answer: Annotation<string | null>,
    /** 结构化 UI 块（列举表格等） */
    assistantBlocks: Annotation<AssistantMessageBlock[] | null>,
    /** 某节点失败时的错误信息，SSE 层会推 error 事件 */
    error: Annotation<string | null>,
    /** true 表示图在 respondEarly 结束，不再进入 Analyst */
    exitEarly: Annotation<boolean>,
    /** 事实核查员：false 且 retryCount < 1 时可打回再检索 */
    checkerPassed: Annotation<boolean>,
    /** 核查打回后的再检索次数（最多 1 次） */
    retryCount: Annotation<number>,
    /** Mem0 + LangMem 注入块（供 Intake / Analyst） */
    memoryBlock: Annotation<string | null>,
    /** Mem0 语义检索原始条目（P0-16 user fact recall） */
    userMemories: Annotation<string[]>,
    /** Intake 使用的截断历史（LangMem 保留最近 N 轮） */
    intakeHistory: Annotation<DbChatTurn[]>,
    /** D5-2：同会话字面重复问，prepareTurnStart 复用 history 答 */
    repeatQuestionHit: Annotation<boolean>,
    /** D5-2：本轮 retrieval 是否命中 KM cache */
    retrievalCacheHit: Annotation<boolean>,
    /** composite：本轮 检索 hits 缓存命中的槽位数 */
    retrievalCacheSlotHits: Annotation<number | null>,
    /** composite / slot：分槽检索结果，供 Analyst 分段写 */
    compositeSubResults: Annotation<CompositeSubRetrieval[] | null>,
    /** composite 增量 槽计划（含 槽答案缓存 命中） */
    compositeIncrementalPlan: Annotation<IncrementalCompositePlan | null>,
    /** 槽答案缓存 命中数 */
    compositeFacetCacheHits: Annotation<number | null>,
    /** prepareTurnStart 注入：年龄等计算基准日 YYYY-MM-DD */
    asOfDate: Annotation<string>,
    /** ToolOrchestrator / DagExecutor 产出，Analyst 优先消费 */
    toolResults: Annotation<PipelineToolResults | null>,
    /** planExecutor 每 step 结果（含 per-step FC） */
    stepResults: Annotation<StepResult[] | null>,
});
export type PipelineGraphState = typeof PipelineGraphAnnotation.State;
