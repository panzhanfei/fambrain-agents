/** 与数据库消息表对齐的对话轮次，供各 Agent 与 pipeline 使用 */
export type DbChatTurn = {
    role: "user" | "assistant" | "system";
    content: string;
};
/** 编排上下文：由 HTTP 层注入，Agent 不直接读 session */
export type AgentPipelineContext = {
    /** 当前登录用户 */
    actorUserId: string;
    /** 本次检索 `data/doc/users/<corpusUserId>/corpus/` 使用的语料归属用户 */
    corpusUserId: string;
    displayName: string;
    /** 当前会话 id（LangMem 会话摘要按会话存储） */
    conversationId: string;
};
export type PipelineStepName =
    | "intake"
    | "retrieval"
    | "fact_checker"
    | "content_summarizer"
    | "content_organizer"
    | "analyst";

/** Pipeline 各节点与端到端耗时（后端 performance.now 统计） */
export type PipelineTiming = {
    totalMs: number;
    ttftMs: number | null;
    nodes: Partial<Record<PipelineStepName, number>>;
};

/** Orchestrator 向 HTTP 层推送的流式事件 */
export type AgentStreamEvent = {
    type: "step";
    name: PipelineStepName;
    status: "running" | "done";
    /** status=done 时：该 step 耗时 */
    durationMs?: number;
} | {
    type: "thinking";
    text: string;
} | {
    type: "assistant";
    text: string;
} | {
    type: "error";
    message: string;
} | {
    /** D5-2：检索 cache 命中（供 eval / 调试） */
    type: "retrieval_meta";
    cacheHit: boolean;
} | {
    /** SLO：pipeline 结束前的耗时汇总 */
    type: "pipeline_timing";
    timing: PipelineTiming;
};
export type AgentPipelineResult = {
    answer: string;
    retrievalCacheHit?: boolean;
    timing?: PipelineTiming;
};
