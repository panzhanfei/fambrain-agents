import { describe, expect, it } from "vitest";
import {
    canonicalizePlanItem,
    dedupePlanByFacet,
    normalizePlanItemFromSchema,
    repairRetrievalPlanItems,
} from "@/agentflow/agents/online/intake-coordinator";

describe("dedupePlanByFacet", () => {
    it("merges duplicate experience enumerations", () => {
        const deduped = dedupePlanByFacet([
            {
                label: "工作经历",
                searchQuery: "工作经历",
                queryType: "enumeration",
                topics: ["experience"],
                enumerationControl: {
                    action: "preview",
                    listKind: "experience",
                    excludeHint: null,
                },
            },
            {
                label: "任职公司及职位列举",
                searchQuery: "公司 职位",
                queryType: "enumeration",
                topics: ["experience"],
                enumerationControl: {
                    action: "exhaustive",
                    listKind: "experience",
                    excludeHint: null,
                },
            },
        ]);
        expect(deduped).toHaveLength(1);
        expect(deduped[0]?.enumerationControl?.action).toBe("exhaustive");
        expect(deduped[0]?.enumerationControl?.listKind).toBe("experience");
    });

    it("keeps project slots with different timeWindowYears", () => {
        const deduped = dedupePlanByFacet([
            {
                label: "近两年项目",
                searchQuery: "项目",
                queryType: "enumeration",
                topics: ["project"],
                enumerationControl: {
                    action: "preview",
                    listKind: "project",
                    excludeHint: null,
                    timeWindowYears: 2,
                },
            },
            {
                label: "全部项目",
                searchQuery: "项目",
                queryType: "enumeration",
                topics: ["project"],
                enumerationControl: {
                    action: "exhaustive",
                    listKind: "project",
                    excludeHint: null,
                    timeWindowYears: null,
                },
            },
        ]);
        expect(deduped).toHaveLength(2);
    });
});

describe("normalizePlanItemFromSchema", () => {
    it("fills tenure searchQuery from identityField catalog", () => {
        const item = normalizePlanItemFromSchema({
            label: "从业年限",
            searchQuery: "随便",
            queryType: "identity",
            topics: [],
            identityField: "tenure",
        });
        expect(item.searchQuery).toMatch(/时间线|工作经历/);
        expect(item.identityField).toBe("tenure");
    });

    it("promotes identityField on default queryType to identity", () => {
        const item = normalizePlanItemFromSchema({
            label: "年龄",
            searchQuery: "年龄",
            queryType: "default",
            topics: [],
            identityField: "age",
        });
        expect(item.queryType).toBe("identity");
        expect(item.identityField).toBe("age");
    });

    it("infers experience listKind from career topics when control incomplete", () => {
        const item = normalizePlanItemFromSchema({
            label: "公司与职位",
            searchQuery: "公司",
            queryType: "enumeration",
            topics: ["career"],
            enumerationControl: {
                action: "preview",
                listKind: "experience",
                excludeHint: null,
            },
        });
        expect(item.enumerationControl?.listKind).toBe("experience");
    });
});

describe("repairRetrievalPlanItems", () => {
    it("does not invent identity fields from oral labels in subTasks", () => {
        const repaired = repairRetrievalPlanItems(
            [
                {
                    label: "工作经历",
                    searchQuery: "公司",
                    queryType: "enumeration",
                    topics: ["experience"],
                    enumerationControl: {
                        action: "exhaustive",
                        listKind: "experience",
                        excludeHint: null,
                    },
                },
            ],
            ["干了多少年", "工作经历", "年龄"],
            "你在IT行业干了多少年了？我今年多大了？"
        );
        expect(repaired.some((p) => p.identityField === "tenure")).toBe(false);
        expect(repaired.some((p) => p.identityField === "age")).toBe(false);
        expect(
            repaired.filter(
                (p) =>
                    p.queryType === "enumeration" &&
                    p.enumerationControl?.listKind === "experience"
            )
        ).toHaveLength(1);
    });

    it("dedupes duplicate experience after normalize", () => {
        const repaired = repairRetrievalPlanItems(
            [
                {
                    label: "工作经历",
                    searchQuery: "a",
                    queryType: "enumeration",
                    topics: ["experience"],
                    enumerationControl: {
                        action: "preview",
                        listKind: "experience",
                        excludeHint: null,
                    },
                },
                {
                    label: "任职公司及职位",
                    searchQuery: "b",
                    queryType: "enumeration",
                    topics: ["experience"],
                    enumerationControl: {
                        action: "exhaustive",
                        listKind: "experience",
                        excludeHint: null,
                    },
                },
            ],
            ["工作经历", "任职公司及职位"],
            ""
        );
        expect(
            repaired.filter(
                (p) => p.enumerationControl?.listKind === "experience"
            )
        ).toHaveLength(1);
    });
});

describe("canonicalizePlanItem identityField", () => {
    it("keeps tenure searchQuery (not generic identity template)", () => {
        const item = canonicalizePlanItem({
            label: "从业年限",
            searchQuery: "个人简介 简历 工作经历 时间线 任职 时间段",
            queryType: "identity",
            topics: ["personal", "resume"],
            identityField: "tenure",
        });
        expect(item.searchQuery).toMatch(/时间线|工作经历/);
        expect(item.topics).toContain("experience");
        expect(item.identityField).toBe("tenure");
    });
});
