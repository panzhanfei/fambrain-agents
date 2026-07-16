import type { IntakeRoutingDecision } from "@/agentflow/agents/online/intake-coordinator/contract";
import { parseIntakeRoutingDecision } from "@/agentflow/agents/online/intake-coordinator/contract";
import {
    buildFallbackRetrievalPlan,
    canonicalizePlanItem,
} from "@/agentflow/agents/online/intake-coordinator/composite";
import { parseJsonObject } from "@/agentflow/utils";

export const parseIntakeDecision = (raw: string): IntakeRoutingDecision | null => {
    const parsed = parseJsonObject<unknown>(raw);
    if (!parsed)
        return null;
    return parseIntakeRoutingDecision(parsed);
};

/** Intake JSON 解析失败时的弱默认：queryType=default，不调口语词表推断 */
export const defaultIntakeDecision = (userQuestion: string): IntakeRoutingDecision => {
    const searchQuery = userQuestion;
    const subTasks: string[] = [];
    const queryType = "default" as const;
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
