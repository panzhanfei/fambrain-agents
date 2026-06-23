/** 各 Agent 控制台日志（服务端调试用）：每个 Agent 仅 📥 进入 / 📤 出去 */
import { enqueuePipelineLog } from "./pipeline-run-context";
export type AgentLogName =
    | "IntakeCoordinator"
    | "KnowledgeManager"
    | "FactChecker"
    | "ContentOrganizer"
    | "ContentSummarizer"
    | "InformationAnalyst"
    | "KnowledgeIndexer"
    | "Pipeline"
    | "Mem0"
    | "UserFact";

export const AGENT_LOG_LABEL_IN = "进入";
export const AGENT_LOG_LABEL_OUT = "出去";

const AGENT_EMOJI: Record<AgentLogName, string> = {
    IntakeCoordinator: "🎫",
    KnowledgeManager: "📚",
    FactChecker: "🔍",
    ContentOrganizer: "📋",
    ContentSummarizer: "📝",
    InformationAnalyst: "🧠",
    KnowledgeIndexer: "📦",
    Pipeline: "🛤️",
    Mem0: "💾",
    UserFact: "🪪",
};

const MAX_JSON_CHARS = 6000;

const truncate = (text: string): string => {
    if (text.length <= MAX_JSON_CHARS)
        return text;
    return `${text.slice(0, MAX_JSON_CHARS)}\n…（已截断，共 ${text.length} 字符）`;
};

const formatPayload = (data: unknown): string => {
    if (typeof data === "string")
        return truncate(data);
    try {
        return truncate(JSON.stringify(data, null, 2));
    }
    catch {
        return truncate(String(data));
    }
};

const prefix = (agent: AgentLogName, tag: string): string => {
    return `${AGENT_EMOJI[agent]} [${agent}] ${tag}`;
};

const previewForLog = (data: unknown): string | undefined => {
    if (data === undefined || data === null || (typeof data === "object" && Object.keys(data as object).length === 0))
        return undefined;
    const text = typeof data === "string" ? data : formatPayload(data);
    return text.length > 480 ? `${text.slice(0, 480)}…` : text;
};

/** Agent 入口：本轮输入摘要 */
export const logAgentIn = (agent: AgentLogName, label: string = AGENT_LOG_LABEL_IN, data: unknown = {}): void => {
    console.log(`${prefix(agent, `📥 ${label}`)}\n${formatPayload(data)}`);
    enqueuePipelineLog({
        agent,
        direction: "in",
        label,
        preview: previewForLog(data),
    });
};

/** Agent 出口：本轮输出摘要 */
export const logAgentOut = (agent: AgentLogName, label: string = AGENT_LOG_LABEL_OUT, data: unknown = {}): void => {
    console.log(`${prefix(agent, `📤 ${label}`)}\n${formatPayload(data)}`);
    enqueuePipelineLog({
        agent,
        direction: "out",
        label,
        preview: previewForLog(data),
    });
};

/**
 * @deprecated 仅保留 API 兼容；中间步骤不再打印，请只用 logAgentIn / logAgentOut。
 */
export const logAgentStep = (_agent: AgentLogName, _step: string, _data: unknown): void => {
    /* no-op */
};
