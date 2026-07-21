import type { IntakeRoutingDecision } from "@/agentflow/agents/online/intake-coordinator/contract";
import { parseIntakeRoutingDecision } from "@/agentflow/agents/online/intake-coordinator/contract";
import { parseJsonObject } from "@/agentflow/utils";

export const parseIntakeDecision = (
  raw: string
): IntakeRoutingDecision | null => {
  const parsed = parseJsonObject<unknown>(raw);
  if (!parsed) return null;
  return parseIntakeRoutingDecision(parsed);
};

/**
 * LLM 未吐 JSON、而是反问散文时的结构兜底（无口语意图词表）。
 * 信号：无 `{` 对象；含问号，或含「请明确/哪个/更多细节」等反问骨架。
 */
export const clarifyFallbackFromProse = (
  raw: string
): IntakeRoutingDecision | null => {
  const t = raw.trim();
  if (!t || t.length < 8 || t.length > 400) return null;
  if (t.includes("{") || t.includes("}")) return null;
  const hasQuestionMark = /[？?]/.test(t);
  const looksLikeClarifyAsk =
    /请(明确|说明|补充|告知)|哪(个|段|项|一)|更多(细节|信息)|具体(指|是哪)/.test(
      t
    );
  if (!hasQuestionMark && !looksLikeClarifyAsk) return null;
  return {
    intent: "clarify",
    searchQuery: "",
    subTasks: [],
    topics: [],
    language: "zh",
    confidence: 0.55,
    queryType: null,
    clarifyingQuestion: t.slice(0, 240),
    briefReply: null,
    retrievalPlan: [],
    pathPlan: { km: [], list: [], tool: [], dag: [] },
    answerOrder: [],
    composeMode: "qa",
    userFactKey: null,
    userFactLabel: null,
    userFactValue: null,
    coreference: "none",
  };
};

/** Intake JSON 解析失败：clarify，不瞎 retrieve / 不发明空 plan */
export const defaultIntakeDecision = (
  _userQuestion: string
): IntakeRoutingDecision => ({
  intent: "clarify",
  searchQuery: "",
  subTasks: [],
  topics: [],
  language: "zh",
  confidence: 0.4,
  queryType: null,
  clarifyingQuestion: "刚才没听清，请再说一次你想了解什么？",
  briefReply: null,
  retrievalPlan: [],
  pathPlan: { km: [], list: [], tool: [], dag: [] },
  answerOrder: [],
  composeMode: "qa",
  userFactKey: null,
  userFactLabel: null,
  userFactValue: null,
  coreference: "none",
});
