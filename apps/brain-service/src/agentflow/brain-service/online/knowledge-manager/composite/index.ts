/**
 * KM composite：多槽增量检索一条线（与 Intake 规划侧的 compositeSlots 对应）。
 */
export {
    buildFacetKey,
    detectCompositeRefreshIntent,
    attachFacetKey,
} from "./facet-key";
export {
    resolveIncrementalCompositePlan,
    cachedFacetToAnalystResult,
    analystResultToCachedFacet,
    type CompositeSlotPlan,
    type IncrementalCompositePlan,
} from "./incremental-plan";
export { retrieveCompositeIncremental } from "./retrieve";
export { retrieveCompositeSlotsParallel } from "./slots-parallel";
export { retrieveSlotWithCache } from "./retrieve-with-cache";
export {
    mergeCompositeHits,
    mergeCompositeRetrieval,
    type CompositeRetrievePlan,
    type CompositeSubRetrieval,
} from "./merge";
