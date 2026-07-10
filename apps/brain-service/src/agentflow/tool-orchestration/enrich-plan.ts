import type { IntakeRetrievalPlanItem } from "@/agentflow/brain-service/online/intake-coordinator/contract/prompt";
import type { CompositeRetrievalSlot } from "@/agentflow/brain-service/online/intake-coordinator/composite/composite-slot-queries";
import type { RoutedIntakeDecision } from "@/agentflow/brain-service/online/intake-coordinator";
import type { QueryProfile } from "@/agentflow/brain-service/online/knowledge-manager";
import {
    extractCompanyHint,
    labelSuggestsWebSource,
    resolveIdentityField,
    userQuestionSuggestsHybridDag,
} from "./field-catalog";
import type { DataSource, EnrichedPlanItem, ExecutionPlanNode, ToolRunId } from "./types";

const enrichItem = (
    item: Pick<
        IntakeRetrievalPlanItem,
        "label" | "searchQuery" | "queryType" | "topics"
    >
): EnrichedPlanItem => {
    const fieldSpec = resolveIdentityField(item.label);
    let dataSource: DataSource = "corpus";
    let toolId: ToolRunId | null = null;

    if (labelSuggestsWebSource(item.label, item.searchQuery)) {
        dataSource = "web";
        toolId = "search_web";
    } else if (item.queryType === "enumeration") {
        toolId = "compose_enumeration";
    } else if (fieldSpec?.requiresCompute && fieldSpec.toolId) {
        dataSource = "compute";
        toolId = fieldSpec.toolId;
    }

    return {
        label: item.label,
        searchQuery: item.searchQuery,
        queryType: item.queryType,
        topics: [...item.topics],
        dataSource,
        field: fieldSpec?.id ?? null,
        toolId,
    };
};

export const enrichRetrievalPlan = (
    plan: IntakeRetrievalPlanItem[]
): EnrichedPlanItem[] => plan.map(enrichItem);

export const enrichCompositeSlots = (
    slots: CompositeRetrievalSlot[]
): Array<CompositeRetrievalSlot & EnrichedPlanItem> =>
    slots.map((slot) => ({
        ...slot,
        ...enrichItem(slot),
    }));

export const buildHybridExecutionPlan = (
    userQuestion: string,
    decision: RoutedIntakeDecision
): ExecutionPlanNode[] => {
    const company = extractCompanyHint(userQuestion, decision.searchQuery);
    const year = new Date().getFullYear();
    return [
        {
            id: "resume",
            label: "个人简历",
            dataSource: "corpus",
            toolId: "retrieve_corpus",
            searchQuery: "个人简介 简历 技能 经历 项目",
            queryType: "identity",
            topics: ["personal", "resume"],
            field: null,
            deps: [],
        },
        {
            id: "company",
            label: "目标公司",
            dataSource: "web",
            toolId: "search_web",
            webQuery: `${company} 公司 业务 招聘 发展 最近`,
            deps: [],
        },
        {
            id: "market",
            label: "市场行情",
            dataSource: "web",
            toolId: "search_web",
            webQuery: `${year} 年 市场行情 行业趋势 招聘`,
            deps: [],
        },
        {
            id: "synthesis",
            label: "综合评估",
            dataSource: "synthesize",
            toolId: "synthesize_merge",
            deps: ["resume", "company", "market"],
        },
    ];
};

export const applyToolPlanGuard = (
    decision: RoutedIntakeDecision,
    userQuestion: string
): RoutedIntakeDecision => {
    if (decision.intent !== "retrieve_and_answer") return decision;

    const enrichedPlan = enrichRetrievalPlan(decision.retrievalPlan ?? []);
    const enrichedSlots = enrichCompositeSlots(decision.compositeSlots ?? []);

    if (userQuestionSuggestsHybridDag(userQuestion)) {
        return {
            ...decision,
            routeMode: "dag",
            compositeSlots: enrichedSlots,
            retrievalPlan: enrichedPlan.map(({ label, searchQuery, queryType, topics }) => ({
                label,
                searchQuery,
                queryType: queryType as QueryProfile,
                topics,
            })),
            executionPlan: buildHybridExecutionPlan(userQuestion, decision),
            routeReason: decision.routeReason ?? "single_default",
        };
    }

    const primaryWeb =
        enrichedPlan.find((p) => p.dataSource === "web") ??
        (labelSuggestsWebSource(userQuestion, decision.searchQuery)
            ? {
                  label: userQuestion,
                  searchQuery: decision.searchQuery,
                  queryType: (decision.queryType ?? "default") as QueryProfile,
                  topics: decision.topics,
                  dataSource: "web" as const,
                  field: null,
                  toolId: "search_web" as const,
              }
            : null);

    return {
        ...decision,
        compositeSlots: enrichedSlots,
        enrichedPlan,
        primaryDataSource: primaryWeb ? "web" : "corpus",
        webQuery: primaryWeb
            ? primaryWeb.searchQuery || userQuestion
            : undefined,
    };
};
