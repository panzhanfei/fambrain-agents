/**
 * Intake guard ⑥：复合路由（首次升成 RoutedIntakeDecision）。
 *
 * 输入：⑤ 之后的 IntakeRoutingDecision（仍无 compositeSlots/pathPlan）
 * 输出：RoutedIntakeDecision
 *
 * 本步：信 LLM retrievalPlan → compositeSlots；空 plan → clarify 早退（不发明槽）。
 */
import {
  isCompositeProfileQuestion,
  resolveCompositeRoute,
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
    default:
      return "skip_non_retrieve";
  }
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

const EMPTY_PLAN_CLARIFY =
  "请再具体一点：你想查哪段经历、哪个项目，或哪一类信息？";

/**
 * Composite 路由主逻辑：
 * 1. 非 retrieve_and_answer → skip
 * 2. resolveCompositeRoute ≥1 槽 → slots
 * 3. 0 槽 → clarify 早退（LLM 未写 retrievalPlan）
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

  if (slots.length >= 1) {
    return applySlotsDecision(
      decision,
      slots,
      sourceToReason(source),
      source
    );
  }

  return {
    ...decision,
    intent: "clarify",
    searchQuery: "",
    queryType: null,
    clarifyingQuestion:
      decision.clarifyingQuestion?.trim() || EMPTY_PLAN_CLARIFY,
    briefReply: null,
    retrievalPlan: [],
    confidence: Math.min(decision.confidence, 0.55),
    routeMode: "skip",
    compositeSlots: [],
    pathPlan: emptyPathPlan(),
    composeMode: defaultComposeMode(),
    routeReason: "skip_non_retrieve",
    routePlanSource: "none",
  };
};
