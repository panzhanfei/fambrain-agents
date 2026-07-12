/** IntakeCoordinator 对外 API；目录按 contract / llm / pipeline / guards / composite 划分。 */

export {
  prompt,
  type IntakeRetrievalPlanItem,
  type IntakeRoutingDecision,
} from "./contract/prompt";
export {
  intakeRetrievalPlanItemSchema,
  intakeRoutingDecisionSchema,
  parseIntakeRoutingDecision,
} from "./contract/schema";

export { completeIntakeCoordinator } from "./llm/ollama-chat";

export {
  intakeRequiresKmRetrieval,
} from "./pipeline/intake-km-routing";
export {
  runIntakePipeline,
  buildEarlyExitRoutedDecision,
  isClarifyEarlyExit,
  isRespondEarlyIntent,
  type RunIntakePipelineResult,
} from "./pipeline/intake-pipeline";

export {
  parseIntakeDecision,
  defaultIntakeDecision,
} from "./pipeline/parse-intake";
export { runIntakeNode } from "./nodes/intake-node";

/** @deprecated 已迁至 respond-early；保留 re-export */
export { runRespondEarlyNode } from "../respond-early";
/** @deprecated 已迁至 user-fact；保留 re-export */
export { userFactNode } from "../user-fact";

/** @deprecated 实现已迁至 repeat-question-guard；保留 re-export 兼容旧 import */
export { findRepeatAnswerInHistory } from "../repeat-question-guard";
export {
    applyIntakeChitchatGuard,
    DEFAULT_CHITCHAT_BRIEF_REPLY,
} from "./guards/intake-chitchat-guard";
export {
  applyIntakeRetrievalPlanGuard,
  type IntakeRetrievalPlanGuardReason,
} from "./guards/intake-retrieval-plan-guard";
export {
  applyEnumerationListIntentGuard,
  resolveEnumerationContinuation,
  buildEnumerationListDecision,
  detectEnumerationContinuationKind,
  isExhaustiveListRequest,
} from "./guards/enumeration-list-intent";

export {
  applyCompositeRouteGuard,
  isCompositeProfileQuestion,
  type CompositeRouteReason,
  type EnumerationListIntent,
  type IntakeRouteMode,
  type RoutedIntakeDecision,
} from "./composite/composite-route-guard";
export {
  buildFallbackRetrievalPlan,
  buildSingleQuestionPlanItem,
  isTechSingleQuestion,
  looksLikeMultiPartQuestion,
  resolveCompositeRoute,
  resolveEffectiveQueryType,
  splitQuestionUnits,
  type CompositeRoutePlanSource,
  type ResolvedCompositeRoute,
} from "./composite/composite-routing";
export {
  COMPOSITE_FACET_IDS,
  COMPOSITE_PROFILE_SLOTS,
  EMPLOYERS_SLOT,
  IDENTITY_SLOT,
  PROJECTS_SLOT,
  canonicalizePlanItem,
  facetTemplateForQueryType,
  getCompositeSlot,
  planItemToSlot,
  type CompositeFacetId,
  type CompositeRetrievalSlot,
  type CompositeSlotId,
} from "./composite/composite-slot-queries";
export {
  isExperienceEnumeration,
  isProjectEnumeration,
  resolveEnumerationTarget,
  type EnumerationTarget,
} from "./composite/enumeration-target";
