/**
 * Intake guard ⑥：复合路由。
 *
 * 输入：LLM + 检索计划 guard 之后的 IntakeRoutingDecision
 * 输出：RoutedIntakeDecision（多了 routeMode / compositeSlots / routeReason）
 *
 * routeMode：
 *   skip  — 不检索（chitchat / clarify / userFact 等）
 *   slots — 1～N 槽 vector 检索（槽数看 compositeSlots.length）
 *   list  — 列举分页 list API（由 enumeration-list-intent guard 升级）
 *   dag   — 工具编排（由 tool-plan guard 升级）
 */
import {
    buildSingleQuestionPlanItem,
    isCompositeProfileQuestion,
    resolveCompositeRoute,
    type CompositeRoutePlanSource,
} from "../composite/composite-routing";
import {
    planItemToSlot,
    type CompositeRetrievalSlot,
} from "../composite/composite-slot-queries";
import type { IntakeRoutingDecision } from "../contract/prompt";
import type { UserFactRoute } from "@/agentflow/brain-service/online/user-fact";
import type {
    EnrichedPlanItem,
    ExecutionPlanNode,
} from "@/agentflow/tool-orchestration/types";

export type IntakeRouteMode = "skip" | "slots" | "list" | "dag";

/** 为何走到当前 routeMode（写进日志 routeReason） */
export type CompositeRouteReason =
    | "skip_non_retrieve"
    | "intake_retrieval_plan"
    | "intake_subtasks_fallback"
    | "structural_multipart_fallback"
    | "query_type_template"
    | "slots_default";

export type EnumerationListIntent = "preview" | "continue" | "exhaustive";

/**
 * Intake 编排工单（写入 state.decision）。
 * 比 LLM 原始 JSON 多：routeMode、compositeSlots、列举分页、工具计划等。
 */
export type RoutedIntakeDecision = IntakeRoutingDecision & {
    routeMode: IntakeRouteMode;
    /** 完整槽对象数组；slots 路由时 length ≥ 1 */
    compositeSlots: CompositeRetrievalSlot[];
    routeReason?: CompositeRouteReason;
    routePlanSource?: CompositeRoutePlanSource;
    /** 用户自述联系方式 remember/recall，不经 KM */
    userFact?: UserFactRoute | null;
    /** preview=首屏；exhaustive=穷举；continue=续页「更多」 */
    listIntent?: EnumerationListIntent | null;
    enumerationPage?: number;
    enumerationPageSize?: number;
    enumerationListKind?: "project" | "experience";
    /** 混合 DAG：Intake 规划，DagExecutor 执行 */
    executionPlan?: ExecutionPlanNode[];
    enrichedPlan?: EnrichedPlanItem[];
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
