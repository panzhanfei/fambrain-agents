/** 与数据库消息表对齐的对话轮次，供各 Agent 与 pipeline 使用 */
export type DbChatTurn = {
    role: "user" | "assistant" | "system";
    content: string;
    /** assistant 结构化块（列举分页等）；续页 Intake 从上一轮 blocks 读 page/pageSize */
    blocks?: import("./message-blocks").AssistantMessageBlock[];
};

export type {
    AssistantMessageBlock,
    AssistantMessagePayload,
    EnumerationListItem,
    EnumerationListKind,
} from "./message-blocks";

/** Analyst / 工具产出的引用（path + excerpt）；贯通 SSE / 消息 metadata / UI */
export type Citation = {
    path: string;
    excerpt: string;
};
/** 本轮聊天附件（已抽取文本；原件由 Brain attachmentBatch 暂存） */
export type TurnAttachment = {
    fileName: string;
    title: string;
    text: string;
    format?: string;
    textLength?: number;
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
    /**
     * 本轮 turnId（由 Web 生成并贯穿；Brain 缺省时兜底生成）。
     * cancel / supersede 均按此 id 点名中止。
     */
    turnId?: string;
    /**
     * vault_wait Resume 载荷。有则走 Command，不 discard 当前 thread。
     * gen_pause 不使用。
     */
    resume?: {
        kind: "vault_action";
        /** 文件子线 FileJob id；Resume 必填 */
        jobId: string;
        prompt?: string;
        /** 写回闸门：弹窗确认的文件基名（不含 .txt） */
        name?: string;
        /** 编辑弹窗保存的全文；有则把打开改成写入 */
        afterContent?: string;
    };
    /** /documents/extract 返回的批次 id（入库时取原件） */
    attachmentBatchId?: string;
    /** 已抽取的附件文本（发送后注入；供 Intake / summarize / translate） */
    turnAttachments?: TurnAttachment[];
};

/** Turn 中止原因：显式停止 vs 新消息顶替 */
export type TurnAbortReason = "cancelled" | "superseded";
export type PipelineStepName =
    | "prepare_turn_start"
    | "repeat_question_guard"
    | "prepare_pipeline_memory"
    | "repeat_respond_early"
    | "intake"
    | "user_fact"
    | "retrieval"
    | "km_retrieve"
    | "list_retrieve"
    | "tool_retrieve"
    | "file_handoff"
    | "file_agent"
    | "plan_cache_resolve"
    | "plan_slot_join"
    | "plan_slot_post"
    | "global_rebatch"
    | "plan_dag"
    | "plan_merge"
    /** @deprecated 旧 SSE 聚合名；新图不再 emit */
    | "plan_executor"
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

/** 单轮 step 事件（与 SSE `step` / 运行日志面板对齐） */
export type TurnStepEvent = {
    name: PipelineStepName;
    status: "running" | "done";
    durationMs?: number;
};

/** 持久化 / 历史回放用的一轮轨迹快照 */
export type TurnTraceSnapshot = {
    timing?: PipelineTiming;
    entries: PipelineLogEntry[];
    steps: TurnStepEvent[];
    status: "done" | "error" | "cancelled" | "superseded" | "paused";
    userQuestion?: string;
    error?: string;
};

import type { AssistantMessageBlock } from "./message-blocks";
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
} | {
    /** 结构化 UI 块（列举表格等） */
    type: "ui_block";
    block: AssistantMessageBlock;
} | {
    /** 本轮助手消息结构化 payload（pipeline 结束前） */
    type: "assistant_message";
    message: {
        plainText: string;
        blocks: AssistantMessageBlock[];
        citations?: Citation[];
    };
} | {
    /** 引用列表（可与 assistant_message 同发；历史回放走 metadata） */
    type: "citations";
    citations: Citation[];
} | {
    /** Turn 被 cancel / supersede；BFF 据此决定是否落库 */
    type: "aborted";
    turnId: string;
    reason: TurnAbortReason;
} | {
    /** 主图已 END，即将交文件子线；BFF 可先落终稿 */
    type: "main_turn_complete";
    answer: string;
    blocks?: AssistantMessageBlock[];
    citations?: Citation[];
} | {
    type: "file_run";
    jobId: string;
    task: "workspace" | "save_offer";
    status: "started" | "noop" | "paused" | "done";
} | {
    /** vault_wait：文件子线 interrupt，载荷见 pauseKind */
    type: "paused";
    turnId: string;
    kind: "vault_wait";
    answer: string;
    blocks?: AssistantMessageBlock[];
    jobId?: string;
};
export type AgentPipelineResult = {
    answer: string;
    /** 结构化块；Web 优先渲染 blocks，content 存 plainText */
    blocks?: AssistantMessageBlock[];
    /** Analyst / 工具引用（path + excerpt） */
    citations?: Citation[];
    /** D5-2：同会话字面重复问，复用 history 答 */
    repeatQuestionHit?: boolean;
    retrievalCacheHit?: boolean;
    /** 槽答案缓存：composite facet 终稿 cache 命中数 */
    compositeFacetCacheHits?: number | null;
    timing?: PipelineTiming;
    /** 本轮 KM 命中的 corpus path，供反馈与 Phase D */
    retrievalPaths?: string[];
    /** 本轮 Agent 日志（入库 / 历史回放） */
    logs?: PipelineLogEntry[];
    /** 本轮 step 轨迹（入库 / 历史回放） */
    steps?: TurnStepEvent[];
    /** Turn 中止时为 true；answer 可能为空或部分缓冲 */
    aborted?: boolean;
    abortReason?: TurnAbortReason;
    turnId?: string;
    paused?: boolean;
    pauseKind?: "vault_wait";
    jobId?: string;
    fileHandoff?: {
        envelope: {
            task: "workspace" | "save_offer";
            draft: string;
            attachmentAction: "extract" | "summarize" | "translate" | null;
            composeMode: "qa" | "composite" | "summarize" | null;
            intent: string | null;
            hasPathSteps: boolean;
            hasSearchQuery: boolean;
            language: "zh" | "en";
            workspaceOp?: {
                operation: string;
                targetPath?: string | null;
                name?: string | null;
                afterContent?: string | null;
                recursive?: boolean;
            };
        };
    } | null;
};
