import { describe, expect, it } from "vitest";
import { applyToolPlanGuard } from "./enrich-plan";
import type { RoutedIntakeDecision } from "@/agentflow/brain-service/online/intake-coordinator";

const baseDecision = (): RoutedIntakeDecision => ({
    intent: "retrieve_and_answer",
    language: "zh",
    subTasks: ["年龄"],
    topics: ["personal"],
    confidence: 0.9,
    clarifyingQuestion: null,
    briefReply: null,
    searchQuery: "年龄",
    queryType: "identity",
    retrievalPlan: [
        {
            label: "年龄",
            searchQuery: "年龄 出生",
            queryType: "identity",
            topics: ["personal"],
        },
    ],
    routeMode: "single",
    compositeSlots: [],
    routeReason: "single_default",
    routePlanSource: "retrieval_plan",
    userFactKey: null,
    userFactLabel: null,
    userFactValue: null,
});

describe("applyToolPlanGuard", () => {
    it("enriches age plan with compute tool", () => {
        const routed = applyToolPlanGuard(baseDecision(), "我今年多大");
        const age = routed.enrichedPlan?.find((p) => p.field === "age");
        expect(age?.toolId).toBe("compute_age_from_hits");
        expect(age?.dataSource).toBe("compute");
    });

    it("routes hybrid questions to dag mode", () => {
        const q = "根据我的简历和今年市场行情，评估我去奥卡云公司的机会";
        const routed = applyToolPlanGuard(baseDecision(), q);
        expect(routed.routeMode).toBe("dag");
        expect(routed.executionPlan?.some((n) => n.id === "synthesis")).toBe(true);
    });
});
