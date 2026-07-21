import { describe, expect, it } from "vitest";
import { applyToolPlanGuard } from "@/agentflow/agents/online/tool-orchestrator";
import {
    applyPathPlanGuard,
    emptyPathPlan,
    type RoutedIntakeDecision,
} from "@/agentflow/agents/online/intake-coordinator";

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
            identityField: "age",
        },
    ],
    routeMode: "skip",
    compositeSlots: [],
    pathPlan: emptyPathPlan(),
    composeMode: "qa",
    routeReason: "intake_retrieval_plan",
    routePlanSource: "intake_retrieval_plan",
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

    it("routes hybrid questions to dag mode via topics.external", () => {
        const q = "根据我的简历和今年市场行情，评估我去奥卡云公司的机会";
        const withTools = applyToolPlanGuard(
            {
                ...baseDecision(),
                topics: ["personal", "resume", "external"],
                searchQuery: "奥卡云 公司 机会 评估",
                retrievalPlan: [
                    {
                        label: "简历匹配",
                        searchQuery: "个人简介 简历 技能",
                        queryType: "identity",
                        topics: ["personal", "resume"],
                    },
                    {
                        label: "市场行情",
                        searchQuery: "市场行情 招聘",
                        queryType: "default",
                        topics: ["external"],
                    },
                ],
                compositeSlots: [
                    {
                        id: "plan-0",
                        label: "简历匹配",
                        searchQuery: "个人简介 简历 技能",
                        queryType: "identity",
                        topics: ["personal", "resume"],
                        subTasks: ["简历匹配"],
                    },
                    {
                        id: "plan-1",
                        label: "市场行情",
                        searchQuery: "市场行情 招聘",
                        queryType: "default",
                        topics: ["external"],
                        subTasks: ["市场行情"],
                    },
                ],
            },
            q
        );
        const routed = applyPathPlanGuard(withTools, q);
        expect(routed.routeMode).toBe("dag");
        expect(
            routed.pathPlan.dag.some((d) => d.template === "hybrid_multi_source")
        ).toBe(true);
        expect(routed.executionPlan?.some((n) => n.id === "synthesis")).toBe(true);
    });
});
