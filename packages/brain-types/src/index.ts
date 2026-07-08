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
    | "prepare_turn_start"
    | "repeat_question_guard"
    | "prepare_pipeline_memory"
    | "repeat_respond_early"
    | "intake"
    | "user_fact"
    | "retrieval"
    | "fact_checker"
    | "content_summarizer"
    | "content_organizer"
    | "analyst"
    | "persist_turn_end";

/** Pipeline 各节点与端到端耗时（后端 performance.now 统计） */
export type PipelineTokenUsage = {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    /** true 表示 Ollama 未返回计数，按字符估算 */
    estimated?: boolean;
    byNode?: Partial<Record<PipelineStepName, {
        prompt: number;
        completion: number;
    }>>;
};

export type PipelineTiming = {
    totalMs: number;
    ttftMs: number | null;
    nodes: Partial<Record<PipelineStepName, number>>;
    tokens?: PipelineTokenUsage;
};

export type PipelineLogEntry = {
    id: string;
    at: string;
    agent: string;
    direction: "in" | "out";
    label: string;
    preview?: string;
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
} | {
    /** 结构化 Agent 日志（Web 运行日志面板） */
    type: "pipeline_log";
    entry: PipelineLogEntry;
};
export type AgentPipelineResult = {
    answer: string;
    /** D5-2：同会话字面重复问，复用 history 答 */
    repeatQuestionHit?: boolean;
    retrievalCacheHit?: boolean;
    /** L3：composite facet 终稿 cache 命中数 */
    compositeFacetCacheHits?: number | null;
    timing?: PipelineTiming;
    /** 本轮 KM 命中的 corpus path，供反馈与 Phase D */
    retrievalPaths?: string[];
};
