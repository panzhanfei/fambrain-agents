/** IntakeCoordinator 对外 API；子目录经各自 index 聚合。 */

export {
  prompt,
  type IntakeRetrievalPlanItem,
  type IntakeRoutingDecision,
} from "./contract";

export { completeIntakeCoordinator } from "./llm";

export {
  intakeRequiresKmRetrieval,
  runIntakePipeline,
  buildEarlyExitRoutedDecision,
  isClarifyEarlyExit,
  isRespondEarlyIntent,
  parseIntakeDecision,
  defaultIntakeDecision,
  type RunIntakePipelineResult,
} from "./pipeline";

export { runIntakeNode } from "./nodes";

/** @deprecated 已迁至 respond-early；保留 re-export */
export { runRespondEarlyNode } from "../respond-early";
/** @deprecated 已迁至 user-fact；保留 re-export */
export { userFactNode } from "../user-fact";

/** @deprecated 实现已迁至 repeat-question-guard；保留 re-export 兼容旧 import */
export { findRepeatAnswerInHistory } from "../repeat-question-guard";

export {
  applyIntakeChitchatGuard,
  DEFAULT_CHITCHAT_BRIEF_REPLY,
  applyIntakeRetrievalPlanGuard,
  applyEnumerationListIntentGuard,
  resolveEnumerationContinuation,
  buildEnumerationListDecision,
  detectEnumerationContinuationKind,
  isExhaustiveListRequest,
  applyCompositeRouteGuard,
  decisionToRetrievalSlot,
  isCompositeProfileQuestion,
  type CompositeRouteReason,
  type EnumerationListIntent,
  type IntakeRetrievalPlanGuardReason,
  type IntakeRouteMode,
  type RoutedIntakeDecision,
} from "./guards";

export {
  buildFallbackRetrievalPlan,
  buildSingleQuestionPlanItem,
  isTechSingleQuestion,
  looksLikeMultiPartQuestion,
  resolveCompositeRoute,
  resolveEffectiveQueryType,
  splitQuestionUnits,
  COMPOSITE_FACET_IDS,
  COMPOSITE_PROFILE_SLOTS,
  EMPLOYERS_SLOT,
  IDENTITY_SLOT,
  PROJECTS_SLOT,
  canonicalizePlanItem,
  facetTemplateForQueryType,
  getCompositeSlot,
  planItemToSlot,
  isExperienceEnumeration,
  isProjectEnumeration,
  resolveEnumerationTarget,
  type CompositeFacetId,
  type CompositeRetrievalSlot,
  type CompositeSlotId,
  type CompositeRoutePlanSource,
  type ResolvedCompositeRoute,
  type EnumerationTarget,
} from "./composite";
