import type { IntakeRoutingDecision } from "@/agentflow/brain-service/online/intake-coordinator/contract";
import { parseIntakeRoutingDecision } from "@/agentflow/brain-service/online/intake-coordinator/contract";
import {
    buildFallbackRetrievalPlan,
    canonicalizePlanItem,
} from "@/agentflow/brain-service/online/intake-coordinator/composite";
import { inferQueryProfile } from "@/agentflow/brain-service/online/knowledge-manager";
import { parseJsonObject } from "@/agentflow/utils";

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
        userFactKey: null,
        userFactLabel: null,
        userFactValue: null,
    };
};
