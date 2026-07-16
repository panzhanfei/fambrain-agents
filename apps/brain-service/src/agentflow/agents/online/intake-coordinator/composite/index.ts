/** Intake composite（规划侧）聚合导出 */
export type {
    CompositeFacetId,
    CompositeRetrievalSlot,
    CompositeRoutePlanSource,
    CompositeSlotId,
    EnumerationTarget,
    EnumerationTargetInput,
    ResolvedCompositeRoute,
} from "./interface";

export {
    buildFallbackRetrievalPlan,
    buildSingleQuestionPlanItem,
    expandIdentityPlanFromSubTasks,
    isTechSingleQuestion,
    looksLikeMultiPartQuestion,
    normalizePlanItems,
    resolveCompositeRoute,
    resolveEffectiveQueryType,
    splitQuestionUnits,
    isCompositeProfileQuestion,
} from "./composite-routing";
export {
    COMPOSITE_FACET_IDS,
    COMPOSITE_PROFILE_SLOTS,
    EMPLOYERS_SLOT,
    EXTERNAL_LINK_SLOT,
    IDENTITY_SLOT,
    PROJECTS_SLOT,
    RECENT_SLOT,
    canonicalizePlanItem,
    facetTemplateForQueryType,
    getCompositeSlot,
    planItemToSlot,
} from "./composite-slot-queries";
export {
    IDENTITY_FIELD_SEARCH,
    type IdentityFieldSearchSpec,
} from "./identity-field-search";
export {
    annotatePlanItem,
    dedupePlanByFacet,
    normalizePlanItemFromSchema,
    planFacetKey,
    repairRetrievalPlanItems,
} from "./repair-retrieval-plan";
export {
    isExperienceEnumeration,
    isProjectEnumeration,
    resolveEnumerationTarget,
} from "./enumeration-target";
