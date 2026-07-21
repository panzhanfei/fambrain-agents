/**
 * IntakeCoordinator 对外 API；子目录经各自 index 聚合。
 * 端到端：LLM 产出 pathPlan + answerOrder；代码合法化并派生 compositeSlots。
 */

export {
  prompt,
  parseIntakeRoutingDecision,
  type IntakeCoreferenceStatus,
  type IntakeIdentityField,
  type IntakeRetrievalPlanItem,
  type IntakeRoutingDecision,
} from "./contract";

export {
  ENUMERATION_ACTION_PROMPTS,
  enumerationActionPrompt,
  matchUiEnumerationPrompt,
  type EnumerationControl,
  type EnumerationListKind,
  type SlotExecutor,
} from "./enumeration";

export {
  decisionRequestsExternalLink,
  hasExplicitMultipartStructure,
  hasStaleMultipartFromDecision,
  isPureSocialUtterance,
  rewriteLastUserTurn,
  shouldRetryCoreferenceMerge,
  shouldShortCircuitIncompleteUtterance,
  buildMergedCoreferenceQuestion,
  normalizeIntakeUtterance,
  surfaceForSingleCharSignal,
} from "./signals";

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

export {
  applyIntakeChitchatGuard,
  applyPureSocialUtteranceGuard,
  buildIncompleteUtteranceDecision,
  buildPureChitchatDecision,
  DEFAULT_CHITCHAT_BRIEF_REPLY,
  INCOMPLETE_UTTERANCE_BRIEF_REPLY,
  applyIntakeRetrievalPlanGuard,
  applyEnumerationSlotGuard,
  buildEnumerationListDecision,
  applyCompositeRouteGuard,
  isCompositeProfileQuestion,
  type CompositeRouteReason,
  type EnumerationListIntent,
  type IntakeRetrievalPlanGuardReason,
  type IntakeRouteMode,
  type RoutedIntakeDecision,
} from "./guards";

export {
  looksLikeMultiPartQuestion,
  resolveCompositeRoute,
  resolveEffectiveQueryType,
  splitQuestionUnits,
  EMPLOYERS_SLOT,
  EXTERNAL_LINK_SLOT,
  IDENTITY_SLOT,
  PROJECTS_SLOT,
  canonicalizePlanItem,
  facetTemplateForQueryType,
  planItemToSlot,
  dedupePlanByFacet,
  normalizePlanItemFromSchema,
  planFacetKey,
  repairRetrievalPlanItems,
  isProjectEnumeration,
  resolveEnumerationTarget,
  type CompositeFacetId,
  type CompositeRetrievalSlot,
  type CompositeSlotId,
  type CompositeRoutePlanSource,
  type ResolvedCompositeRoute,
  type EnumerationTarget,
} from "./composite";

export {
  applyPathPlanGuard,
  compilePathPlan,
  pathPlanToCompositeSlots,
  emptyPathPlan,
  defaultComposeMode,
  expandHybridMultiSourceTemplate,
  deriveCompositeSlotsFromPathPlan,
  deriveRetrievalPlanFromPathPlan,
  legalizePathPlan,
  legalizeAnswerOrder,
  legalizeComposeMode,
  fillListPagesInPathPlan,
  isPathPlanEmpty,
  type ComposeMode,
  type PathPlan,
  type PathKind,
  type ListStep,
  type KmStep,
  type StepResult,
  type DagTemplateId,
} from "./path-plan";
