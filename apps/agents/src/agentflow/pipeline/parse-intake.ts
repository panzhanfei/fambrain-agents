import { parseIntakeRoutingDecision } from "@/agentflow/agents/online/intake-coordinator/schema";
import { buildFallbackRetrievalPlan } from "@/agentflow/agents/online/intake-coordinator/composite-routing";
import { canonicalizePlanItem } from "@/agentflow/agents/online/intake-coordinator/composite-slot-queries";
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
    const queryType = inferQueryProfile(searchQuery, subTasks);
    const base = {
        searchQuery,
        subTasks,
        topics: [] as string[],
        queryType,
    };
    const fallbackPlan = buildFallbackRetrievalPlan(userQuestion, base).map(
        canonicalizePlanItem
    );
    return {
        intent: "retrieve_and_answer",
        needsRetrieval: true,
        searchQuery,
        subTasks:
            fallbackPlan.length >= 2
                ? fallbackPlan.map((p) => p.label)
                : subTasks,
        topics: [],
        language: "zh",
        confidence: 0.4,
        queryType,
        clarifyingQuestion: null,
        briefReply: null,
        retrievalPlan: fallbackPlan.length >= 2 ? fallbackPlan : [],
    };
};
