/** 各 Agent 控制台日志（服务端调试用） */

export type AgentLogName =
  | "IntakeCoordinator"
  | "KnowledgeManager"
  | "FactChecker"
  | "ContentOrganizer"
  | "InformationAnalyst"
  | "Pipeline"
  | "Mem0";

const AGENT_EMOJI: Record<AgentLogName, string> = {
  IntakeCoordinator: "🎫",
  KnowledgeManager: "📚",
  FactChecker: "🔍",
  ContentOrganizer: "📋",
  InformationAnalyst: "🧠",
  Pipeline: "🛤️",
  Mem0: "💾",
};

/** 仅这些 Agent 打印中间步骤（logAgentStep）；其余 Agent 只打 📥/📤 */
const STEP_VERBOSE_AGENTS: ReadonlySet<AgentLogName> = new Set(["FactChecker"]);

/** Pipeline 仅打印「本轮开始 / 本轮结束*」，中间编排细节默认静默 */
function shouldLogAgentOut(agent: AgentLogName, label: string): boolean {
  if (agent !== "Pipeline") return true;
  return label === "本轮开始" || label.startsWith("本轮结束");
}

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
  return `${AGENT_EMOJI[agent]} [${agent}] ${tag}`;
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
  if (!shouldLogAgentOut(agent, label)) return;
  console.log(`${prefix(agent, `📤 ${label}`)}\n${formatPayload(data)}`);
}

/** 打印 Agent 内部步骤（默认仅 FactChecker 启用，避免淹没其它 Agent 的 📥/📤） */
export function logAgentStep(
  agent: AgentLogName,
  step: string,
  data: unknown
): void {
  if (!STEP_VERBOSE_AGENTS.has(agent)) return;
  console.log(`${prefix(agent, `🔹 ${step}`)}\n${formatPayload(data)}`);
}
