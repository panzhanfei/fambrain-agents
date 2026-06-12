import { parseIntakeRoutingDecision } from "@/agentflow/agents/online/intake-coordinator/schema";
import { parseJsonObject } from "@/agentflow/utils";
import type { IntakeRoutingDecision } from "@/agentflow/agents/online/intake-coordinator";
export const parseIntakeDecision = (raw: string): IntakeRoutingDecision | null => {
    const parsed = parseJsonObject<unknown>(raw);
    if (!parsed)
        return null;
    return parseIntakeRoutingDecision(parsed);
};
export const defaultIntakeDecision = (userQuestion: string): IntakeRoutingDecision => {
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
};
