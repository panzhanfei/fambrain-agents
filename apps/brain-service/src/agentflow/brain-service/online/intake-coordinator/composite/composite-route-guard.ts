/**
 * Intake guard ⑥：复合路由。
 *
 * 输入：LLM + 检索计划 guard 之后的 IntakeRoutingDecision
 * 输出：RoutedIntakeDecision（多了 routeMode / compositeSlots / routeReason）
 *
 * 职责：决定「单问还是多分槽」，不负责真检索。
 * 检索在 retrieval-node：composite/slot → 增量计划 → 并行 KM。
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

/** 图路由模式：single 普通单问；composite ≥2 槽；slot 单槽结构化；dag 混合执行 */
export type IntakeRouteMode = "single" | "composite" | "slot" | "dag";

/** 为何走到当前 routeMode（写进日志 routeReason） */
export type CompositeRouteReason =
    | "skip_non_retrieve"
    | "intake_retrieval_plan"
    | "intake_subtasks_fallback"
    | "structural_multipart_fallback"
    | "query_type_template"
    | "single_default";

export type EnumerationListIntent = "preview" | "continue" | "exhaustive";

/**
 * Intake 编排工单（写入 state.decision）。
 * 比 LLM 原始 JSON 多：routeMode、compositeSlots、列举分页、工具计划等。
 */
export type RoutedIntakeDecision = IntakeRoutingDecision & {
    routeMode: IntakeRouteMode;
    /** 完整槽对象数组；「最终路由」日志只打 count/labels 摘要 */
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
            return "single_default";
    }
};

/** ≥1 槽时：强制 retrieve_and_answer，顶层 searchQuery 取首槽（兼容单问字段） */
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
 * Composite 路由主逻辑：
 * 1. 非 retrieve_and_answer → single（不检索）
 * 2. resolveCompositeRoute ≥2 槽 → composite
 * 3. 1 槽：tech 单问例外 → single；否则 → slot
 * 4. 0 槽 → single（沿用原 searchQuery）
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

    // 真正拆槽：retrievalPlan / subTasks / 句式 / queryType 模板
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
        // 「城管用了什么技术」类 tech 单问：不要误进 slot，走普通单问检索
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
