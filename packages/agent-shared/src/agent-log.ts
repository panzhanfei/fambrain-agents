/** 各 Agent 控制台日志（服务端调试用） */
export type AgentLogName = "IntakeCoordinator" | "KnowledgeManager" | "FactChecker" | "ContentOrganizer" | "InformationAnalyst" | "KnowledgeIndexer" | "Pipeline" | "Mem0";
const AGENT_EMOJI: Record<AgentLogName, string> = {
    IntakeCoordinator: "🎫",
    KnowledgeManager: "📚",
    FactChecker: "🔍",
    ContentOrganizer: "📋",
    InformationAnalyst: "🧠",
    KnowledgeIndexer: "📦",
    Pipeline: "🛤️",
    Mem0: "💾",
};
/** 仅这些 Agent 打印中间步骤（logAgentStep）；其余 Agent 只打 📥/📤 */
const STEP_VERBOSE_AGENTS: ReadonlySet<AgentLogName> = new Set(["FactChecker", "KnowledgeIndexer"]);
const shouldLogAgentOut = (agent: AgentLogName, label: string): boolean => {
    if (agent !== "Pipeline")
        return true;
    return label === "本轮开始" || label.startsWith("本轮结束");
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
export const logAgentIn = (agent: AgentLogName, label: string, data: unknown): void => {
    console.log(`${prefix(agent, `📥 ${label}`)}\n${formatPayload(data)}`);
};
export const logAgentOut = (agent: AgentLogName, label: string, data: unknown): void => {
    if (!shouldLogAgentOut(agent, label))
        return;
    console.log(`${prefix(agent, `📤 ${label}`)}\n${formatPayload(data)}`);
};
export const logAgentStep = (agent: AgentLogName, step: string, data: unknown): void => {
    if (!STEP_VERBOSE_AGENTS.has(agent))
        return;
    console.log(`${prefix(agent, `🔹 ${step}`)}\n${formatPayload(data)}`);
};
