/** 各 Agent 控制台日志（服务端调试用） */

export type AgentLogName =
  | "IntakeCoordinator"
  | "KnowledgeManager"
  | "FactChecker"
  | "ContentOrganizer"
  | "InformationAnalyst"
  | "Pipeline";

const AGENT_EMOJI: Record<AgentLogName, string> = {
  IntakeCoordinator: "🎫",
  KnowledgeManager: "📚",
  FactChecker: "🔍",
  ContentOrganizer: "📋",
  InformationAnalyst: "🧠",
  Pipeline: "🛤️",
};

const MAX_JSON_CHARS = 6_000;

function truncate(text: string): string {
  if (text.length <= MAX_JSON_CHARS) return text;
  return `${text.slice(0, MAX_JSON_CHARS)}\n…（已截断，共 ${text.length} 字符）`;
}

function formatPayload(data: unknown): string {
  if (typeof data === "string") return truncate(data);
  try {
    return truncate(JSON.stringify(data, null, 2));
  } catch {
    return truncate(String(data));
  }
}

function prefix(agent: AgentLogName, tag: string): string {
  return `😋 ${AGENT_EMOJI[agent]} [${agent}] ${tag}`;
}

/** 打印 Agent 输入 */
export function logAgentIn(
  agent: AgentLogName,
  label: string,
  data: unknown
): void {
  console.log(`${prefix(agent, `📥 ${label}`)}\n${formatPayload(data)}`);
}

/** 打印 Agent 输出 */
export function logAgentOut(
  agent: AgentLogName,
  label: string,
  data: unknown
): void {
  console.log(`${prefix(agent, `📤 ${label}`)}\n${formatPayload(data)}`);
}
