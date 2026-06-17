import { parseIntakeRoutingDecision } from "@/agentflow/agents/online/intake-coordinator/schema";
import { inferQueryProfile } from "@/agentflow/agents/online/knowledge-manager/query-profile";
import { parseJsonObject } from "@/agentflow/utils";
import type { IntakeRoutingDecision } from "@/agentflow/agents/online/intake-coordinator";
export const parseIntakeDecision = (raw: string): IntakeRoutingDecision | null => {
    const parsed = parseJsonObject<unknown>(raw);
    if (!parsed)
        return null;
    return parseIntakeRoutingDecision(parsed);
};
export const defaultIntakeDecision = (userQuestion: string): IntakeRoutingDecision => {
    const searchQuery = userQuestion;
    const subTasks: string[] = [];
    return {
        intent: "retrieve_and_answer",
        needsRetrieval: true,
        searchQuery,
        subTasks,
        topics: [],
        language: "zh",
        confidence: 0.4,
        queryType: inferQueryProfile(searchQuery, subTasks),
        clarifyingQuestion: null,
        briefReply: null,
    };
};
