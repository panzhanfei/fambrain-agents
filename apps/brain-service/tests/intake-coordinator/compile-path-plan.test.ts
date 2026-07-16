import { describe, expect, it } from "vitest";
import {
    applyCompositeRouteGuard,
    applyPathPlanGuard,
    compilePathPlan,
    emptyPathPlan,
    type RoutedIntakeDecision,
} from "@/agentflow/agents/online/intake-coordinator";

const base = (): RoutedIntakeDecision => ({
    intent: "retrieve_and_answer",
    searchQuery: "项目经历",
    subTasks: ["列举所有项目", "开源项目的 GitHub 与线上地址"],
    topics: ["project", "personal"],
    language: "zh",
    confidence: 0.9,
    queryType: "enumeration",
    clarifyingQuestion: null,
    briefReply: null,
    retrievalPlan: [
        {
            label: "列举所有项目名称",
            searchQuery: "项目经历 全部项目 项目名称",
            queryType: "enumeration",
            topics: ["project"],
            enumerationControl: {
                action: "preview",
                listKind: "project",
                excludeHint: null,
            },
        },
        {
            label: "开源项目的 GitHub 与线上地址",
            searchQuery: "个人简介 简历 开源 GitHub",
            queryType: "external_link",
            topics: ["personal", "resume", "project"],
        },
    ],
    userFactKey: null,
    userFactLabel: null,
    userFactValue: null,
    routeMode: "slots",
    compositeSlots: [],
    pathPlan: emptyPathPlan(),
    composeMode: "qa",
});

describe("compilePathPlan", () => {
    it("compiles enumeration + external_link as km/list slots (no scene DAG)", () => {
        const routed = applyCompositeRouteGuard(
            base(),
            "列出所有项目并告诉我开源 GitHub"
        );
        const { pathPlan, composeMode } = compilePathPlan(
            routed,
            "列出所有项目并告诉我开源 GitHub"
        );
        expect(pathPlan.dag).toHaveLength(0);
        expect(
            pathPlan.km.some((k) => k.queryType === "external_link")
        ).toBe(true);
        expect(
            pathPlan.list.length > 0 ||
                pathPlan.km.some((k) => k.queryType === "enumeration")
        ).toBe(true);
        expect(composeMode).toBe("composite");
    });

    it("applyPathPlanGuard preserves Intake slot order", () => {
        const routed = applyCompositeRouteGuard(
            base(),
            "列出所有项目并告诉我开源 GitHub"
        );
        // age → name → projects → links order simulation
        routed.compositeSlots = [
            {
                id: "identity-0",
                label: "年龄",
                searchQuery: "个人简介 简历 年龄",
                queryType: "identity",
                topics: ["personal", "resume"],
                subTasks: ["年龄"],
                identityField: "age",
                executor: "km_retrieve",
            },
            {
                id: "identity-1",
                label: "姓名",
                searchQuery: "个人简介 简历 姓名",
                queryType: "identity",
                topics: ["personal", "resume"],
                subTasks: ["姓名"],
                identityField: "name",
                executor: "km_retrieve",
            },
            {
                id: "projects-2",
                label: "项目经历",
                searchQuery: "项目经历 全部项目",
                queryType: "enumeration",
                topics: ["project"],
                subTasks: ["项目经历"],
                executor: "list_corpus",
                enumerationControl: {
                    action: "exhaustive",
                    listKind: "project",
                    excludeHint: null,
                },
            },
            {
                id: "external_link-3",
                label: "开源链接",
                searchQuery: "对外链接",
                queryType: "external_link",
                topics: ["personal", "resume", "project"],
                subTasks: ["开源链接"],
                executor: "km_retrieve",
            },
        ];
        const withPlan = applyPathPlanGuard(
            routed,
            "我今年多大了？叫什么？列出项目和开源地址"
        );
        expect(withPlan.pathPlan.dag).toHaveLength(0);
        expect(withPlan.composeMode).toBe("composite");
        expect(withPlan.compositeSlots.map((s) => s.queryType)).toEqual([
            "identity",
            "identity",
            "enumeration",
            "external_link",
        ]);
        expect(withPlan.compositeSlots.map((s) => s.label)).toEqual([
            "年龄",
            "姓名",
            "项目经历",
            "开源链接",
        ]);
    });
});
