/**
 * P0-15 / R6-3：Intake retrievalPlan 主路由 + 结构/queryType 兜底；动态槽（按需子集）。
 */
import {
    isCompositeProfileQuestion,
    isTechSingleQuestion,
    resolveCompositeRoute,
    type CompositeRoutePlanSource,
} from "./composite-routing";
import type { CompositeRetrievalSlot } from "./composite-slot-queries";
import type { IntakeRoutingDecision } from "../contract/prompt";
import type { UserFactRoute } from "@/agentflow/brain-service/online/user-fact";
import type {
    EnrichedPlanItem,
    ExecutionPlanNode,
} from "@/agentflow/tool-orchestration/types";

export type IntakeRouteMode = "single" | "composite" | "slot" | "dag";

export type CompositeRouteReason =
    | "skip_non_retrieve"
    | "intake_retrieval_plan"
    | "intake_subtasks_fallback"
    | "structural_multipart_fallback"
    | "query_type_template"
    | "single_default";

export type EnumerationListIntent = "preview" | "continue" | "exhaustive";

export type RoutedIntakeDecision = IntakeRoutingDecision & {
    routeMode: IntakeRouteMode;
    compositeSlots: CompositeRetrievalSlot[];
    routeReason?: CompositeRouteReason;
    routePlanSource?: CompositeRoutePlanSource;
    /** P0-16：用户自述联系方式 remember/recall，不经 KM */
    userFact?: UserFactRoute | null;
    /** 列举分页：preview=首屏8条；exhaustive=单问穷举；continue=续页 */
    listIntent?: EnumerationListIntent | null;
    enumerationPage?: number;
    enumerationPageSize?: number;
    enumerationListKind?: "project" | "experience";
    /** 混合 DAG：Intake 规划，DagExecutor 执行 */
    executionPlan?: ExecutionPlanNode[];
    /** guard 富化后的计划项（含 dataSource / toolId） */
    enrichedPlan?: EnrichedPlanItem[];
    /** 主路径数据源：语料优先，外部事实可走 web */
    primaryDataSource?: "corpus" | "web";
    webQuery?: string;
};

const sourceToReason = (
    source: CompositeRoutePlanSource
): CompositeRouteReason => {
    switch (source) {
        case "intake_retrieval_plan":
            return "intake_retrieval_plan";
        case "intake_subtasks":
            return "intake_subtasks_fallback";
        case "structural_multipart":
            return "structural_multipart_fallback";
        case "query_type_template":
            return "query_type_template";
        default:
            return "single_default";
    }
};

const applySlotDecision = (
    decision: IntakeRoutingDecision,
    slots: CompositeRetrievalSlot[],
    mode: IntakeRouteMode,
    routeReason: CompositeRouteReason,
    routePlanSource: CompositeRoutePlanSource
): RoutedIntakeDecision => {
    const primary = slots[0]!;
    return {
        ...decision,
        intent: "retrieve_and_answer",
        routeMode: mode,
        compositeSlots: slots,
        routeReason,
        routePlanSource,
        searchQuery: primary.searchQuery,
        queryType: primary.queryType,
        topics: [...primary.topics],
        subTasks: slots.map((s) => s.label),
        clarifyingQuestion: null,
        briefReply: null,
    };
};

export { isCompositeProfileQuestion };

/**
 * Composite 路由：
 * 1. 非检索短路 → single
 * 2. resolveCompositeRoute ≥2 槽 → composite（动态子集）
 * 3. 1 槽 → slot（tech 单问除外 → single）
 * 4. 0 槽 → single（沿用 Intake searchQuery）
 */
export const applyCompositeRouteGuard = (
    decision: IntakeRoutingDecision,
    userQuestion: string
): RoutedIntakeDecision => {
    if (
        decision.intent !== "retrieve_and_answer"
    ) {
        return {
            ...decision,
            routeMode: "single",
            compositeSlots: [],
            routeReason: "skip_non_retrieve",
            routePlanSource: "none",
        };
    }

    const { slots, source } = resolveCompositeRoute(decision, userQuestion);
    const routeReason = sourceToReason(source);

    if (slots.length >= 2) {
        return applySlotDecision(
            decision,
            slots,
            "composite",
            routeReason,
            source
        );
    }

    if (slots.length === 1) {
        if (isTechSingleQuestion(userQuestion, decision)) {
            return {
                ...decision,
                routeMode: "single",
                compositeSlots: [],
                routeReason: "single_default",
                routePlanSource: "none",
            };
        }
        return applySlotDecision(decision, slots, "slot", routeReason, source);
    }

    return {
        ...decision,
        routeMode: "single",
        compositeSlots: [],
        routeReason: "single_default",
        routePlanSource: "none",
    };
};
