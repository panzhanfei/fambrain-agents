import { describe, expect, it } from "vitest";
import { buildEnumerationListDecision } from "@/agentflow/agents/online/intake-coordinator/guards/enumeration-list-intent";
import { isPureListDecision } from "@/agentflow/agents/online/corpus-lister/pure-list-route";

describe("isPureListDecision", () => {
    it("returns true for UI exhaustive list decision", () => {
        const decision = buildEnumerationListDecision({
            userQuestion: "更多项目",
            listKind: "project",
            listIntent: "continue",
            page: 2,
            pageSize: 20,
        });
        expect(isPureListDecision(decision)).toBe(true);
        expect(decision.pathPlan.list.length).toBe(1);
        expect(decision.pathPlan.km.length).toBe(0);
    });

    it("returns false when km slot present", () => {
        const listOnly = buildEnumerationListDecision({
            userQuestion: "全部列出项目",
            listKind: "project",
            listIntent: "exhaustive",
            page: 1,
            pageSize: 20,
        });
        const mixed = {
            ...listOnly,
            compositeSlots: [
                listOnly.compositeSlots[0]!,
                {
                    ...listOnly.compositeSlots[0]!,
                    id: "tech-0",
                    executor: "km_retrieve" as const,
                    queryType: "tech" as const,
                },
            ],
            pathPlan: {
                km: [{ id: "km-0", pathKind: "km" as const, label: "tech", searchQuery: "react", queryType: "tech" as const, topics: [] }],
                list: listOnly.pathPlan.list,
                tool: [],
                dag: [],
            },
        };
        expect(isPureListDecision(mixed)).toBe(false);
    });
});
