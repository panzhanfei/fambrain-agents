/**
 * Intake guard ⑥：复合路由（首次升成 RoutedIntakeDecision）。
 *
 * 输入：⑤ 之后的 IntakeRoutingDecision（仍无 compositeSlots/pathPlan）
 * 输出：RoutedIntakeDecision
 *
 * 本步新增/改写：
 *   + routeMode（此处多为 slots；skip 仅非 retrieve）
 *   + compositeSlots[]（有序执行槽；回答顺序）
 *   + composeMode（1 槽 qa；≥2 composite）
 *   + routeReason / routePlanSource
 *   + pathPlan = empty（⑨ 才编译四桶）
 *   Δ searchQuery/queryType/topics 取自首槽（兼容单问字段）
 *
 * list / dag 由后续 ⑦⑧ 升级；执行最终以 ⑨ pathPlan 为准。
 */
import {
    buildSingleQuestionPlanItem,
    isCompositeProfileQuestion,
    resolveCompositeRoute,
    planItemToSlot,
    type CompositeRetrievalSlot,
    type CompositeRoutePlanSource,
} from "@/agentflow/agents/online/intake-coordinator/composite";
import type { IntakeRoutingDecision } from "@/agentflow/agents/online/intake-coordinator/contract";
import {
    defaultComposeMode,
    emptyPathPlan,
} from "@/agentflow/agents/online/intake-coordinator/path-plan";
import type {
    CompositeRouteReason,
    RoutedIntakeDecision,
} from "./interface";

export type {
    CompositeRouteReason,
    EnumerationListIntent,
    IntakeRouteMode,
    RoutedIntakeDecision,
} from "./interface";

export { isCompositeProfileQuestion };

const sourceToReason = (
    source: CompositeRoutePlanSource
): CompositeRouteReason => {
    switch (source) {
        case "intake_retrieval_plan":
            return "intake_retrieval_plan";
        case "query_type_template":
            return "query_type_template";
        default:
            return "slots_default";
    }
};

/** 单问 fallback：顶层 decision → 1 个检索槽 */
export const decisionToRetrievalSlot = (
    decision: IntakeRoutingDecision,
    userQuestion: string
): CompositeRetrievalSlot => {
    const fromPlan = buildSingleQuestionPlanItem(userQuestion, decision);
    if (fromPlan) {
        return planItemToSlot(fromPlan, 0);
    }
    const queryType = decision.queryType ?? "default";
    return {
        id: "plan-0",
        label:
            decision.subTasks[0]?.trim() ||
            userQuestion.trim().slice(0, 40) ||
            "查询",
        searchQuery: (decision.searchQuery || userQuestion).trim(),
        queryType,
        topics: [...decision.topics],
        subTasks:
            decision.subTasks.length > 0 ? [...decision.subTasks] : [],
    };
};

/** ≥1 槽：强制 retrieve_and_answer，顶层 searchQuery 取首槽（兼容单问字段） */
const applySlotsDecision = (
    decision: IntakeRoutingDecision,
    slots: CompositeRetrievalSlot[],
    routeReason: CompositeRouteReason,
    routePlanSource: CompositeRoutePlanSource
): RoutedIntakeDecision => {
    const primary = slots[0]!;
    return {
        ...decision,
        intent: "retrieve_and_answer",
        routeMode: "slots",
        compositeSlots: slots,
        pathPlan: emptyPathPlan(),
        composeMode: slots.length >= 2 ? "composite" : "qa",
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

/**
 * Composite 路由主逻辑：
 * 1. 非 retrieve_and_answer → skip
 * 2. resolveCompositeRoute ≥1 槽 → slots
 * 3. 0 槽 → decisionToRetrievalSlot 包装为 1 槽 slots
 */
export const applyCompositeRouteGuard = (
    decision: IntakeRoutingDecision,
    userQuestion: string
): RoutedIntakeDecision => {
    if (decision.intent !== "retrieve_and_answer") {
        return {
            ...decision,
            routeMode: "skip",
            compositeSlots: [],
            pathPlan: emptyPathPlan(),
            composeMode: defaultComposeMode(),
            routeReason: "skip_non_retrieve",
            routePlanSource: "none",
        };
    }

    const { slots, source } = resolveCompositeRoute(decision, userQuestion);
    const routeReason = sourceToReason(source);

    if (slots.length >= 1) {
        return applySlotsDecision(decision, slots, routeReason, source);
    }

    return applySlotsDecision(
        decision,
        [decisionToRetrievalSlot(decision, userQuestion)],
        "slots_default",
        "none"
    );
};
