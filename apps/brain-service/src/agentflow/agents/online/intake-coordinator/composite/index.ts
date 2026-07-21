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
    looksLikeMultiPartQuestion,
    normalizePlanItems,
    resolveCompositeRoute,
    resolveEffectiveQueryType,
    splitQuestionUnits,
    isCompositeProfileQuestion,
} from "./composite-routing";
export {
    EMPLOYERS_SLOT,
    EXTERNAL_LINK_SLOT,
    IDENTITY_SLOT,
    PROJECTS_SLOT,
    canonicalizePlanItem,
    facetTemplateForQueryType,
    planItemToSlot,
} from "./composite-slot-queries";
export {
    IDENTITY_FIELD_SEARCH,
    type IdentityFieldSearchSpec,
} from "./identity-field-search";
export {
    dedupePlanByFacet,
    normalizePlanItemFromSchema,
    planFacetKey,
    repairRetrievalPlanItems,
} from "./repair-retrieval-plan";
export {
    isProjectEnumeration,
    resolveEnumerationTarget,
} from "./enumeration-target";
