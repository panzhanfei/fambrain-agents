/**
 * KM composite：多槽增量检索一条线（与 Intake 规划侧的 compositeSlots 对应）。
 */
export type {
    CompositeRetrievePlan,
    CompositeSlotPlan,
    CompositeSubRetrieval,
    IncrementalCompositePlan,
} from "./interface";
export {
    buildFacetKey,
    detectCompositeRefreshIntent,
    attachFacetKey,
} from "./facet-key";
export {
    resolveIncrementalCompositePlan,
    cachedFacetToAnalystResult,
    analystResultToCachedFacet,
} from "./incremental-plan";
export { retrieveCompositeIncremental } from "./retrieve";
export { retrieveCompositeSlotsParallel } from "./slots-parallel";
export { retrieveSlotWithCache } from "./retrieve-with-cache";
export {
    mergeCompositeHits,
    mergeCompositeRetrieval,
} from "./merge";
