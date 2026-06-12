import { Annotation } from "@langchain/langgraph";
import type { AgentPipelineContext, DbChatTurn, } from "@fambrain/agent-types";
import type { IntakeRoutingDecision } from "@/agentflow/agents/online/intake-coordinator";
import type { InformationAnalystInput } from "@/agentflow/agents/online/information-analyst";
/**
 * LangGraph 编排共享状态（Intake → KM → FactChecker → ContentOrganizer → Analyst；摘要分支 Intake → KM → ContentSummarizer）。
 * 初始值由 `stream.ts` 的 `buildInitialState()` 注入；节点只返回需要更新的字段。
 */
export const PipelineGraphAnnotation = Annotation.Root({
    /** 本轮及历史对话轮次，供 IntakeCoordinator 理解上下文 */
    history: Annotation<DbChatTurn[]>,
    /** HTTP 层注入：登录用户、语料归属、展示名（Agent 不直接读 session） */
    context: Annotation<AgentPipelineContext>,
    /** 用户最新一条问题（从 history 提取，供检索与分析） */
    userQuestion: Annotation<string>,
    /** IntakeCoordinator 路由 JSON：intent、needsRetrieval、searchQuery 等 */
    decision: Annotation<IntakeRoutingDecision | null>,
    /** KnowledgeManager 检索命中的文档片段，交给 InformationAnalyst */
    hits: Annotation<InformationAnalystInput["hits"]>,
    /** 检索证据是否充分：sufficient / partial / none */
    coverage: Annotation<InformationAnalystInput["coverage"]>,
    /** 知识管理员给分析师的备注；无则为 null */
    notes: Annotation<InformationAnalystInput["notes"]>,
    /** 澄清 / 闲聊 / briefReply 等提前结束时的终稿（不经 Analyst） */
    answer: Annotation<string | null>,
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
    /** Intake 使用的截断历史（LangMem 保留最近 N 轮） */
    intakeHistory: Annotation<DbChatTurn[]>,
});
export type PipelineGraphState = typeof PipelineGraphAnnotation.State;
