import { parseIntakeRoutingDecision } from "@/agentflow/agents/online/intake-coordinator/schema";
import { parseJsonObject } from "@/agentflow/utils";
import type { IntakeRoutingDecision } from "@/agentflow/agents/online/intake-coordinator";

/** 从接线员回复里解析路由 JSON */
export function parseIntakeDecision(raw: string): IntakeRoutingDecision | null {
  const parsed = parseJsonObject<unknown>(raw);
  if (!parsed) return null;
  return parseIntakeRoutingDecision(parsed);
}

/** 解析失败时的保守默认：按用户原话去检索 */
export function defaultIntakeDecision(
  userQuestion: string
): IntakeRoutingDecision {
  return {
    intent: "retrieve_and_answer",
    needsRetrieval: true,
    searchQuery: userQuestion,
    subTasks: [],
    topics: [],
    language: "zh",
    confidence: 0.4,
    clarifyingQuestion: null,
    briefReply: null,
  };
}
