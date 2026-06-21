import type { IncrementalCompositePlan } from "@/agentflow/agents/online/intake-coordinator/composite-incremental";
import { retrieveCompositeSlotsParallel } from "./retrieve-slots-parallel";
import {
    mergeCompositeRetrieval,
    type CompositeSubRetrieval,
} from "./merge-composite-retrieval";

/** composite 增量检索：L3 命中槽跳过 KM，仅对 active 槽并行 L2 */
export const retrieveCompositeIncremental = async (input: {
    corpusUserId: string;
    plan: IncrementalCompositePlan;
}): Promise<{
    subResults: CompositeSubRetrieval[];
    cacheHits: number;
    merged: ReturnType<typeof mergeCompositeRetrieval>;
}> => {
    const active =
        input.plan.activeRetrievalSlots.length > 0
            ? await retrieveCompositeSlotsParallel({
                  corpusUserId: input.corpusUserId,
                  slots: input.plan.activeRetrievalSlots,
              })
            : {
                  subResults: [] as CompositeSubRetrieval[],
                  cacheHits: 0,
                  merged: mergeCompositeRetrieval([]),
              };

    const subResults: CompositeSubRetrieval[] = [];
    let activeIdx = 0;

    for (const slotPlan of input.plan.slots) {
        if (slotPlan.useCachedAnswer && slotPlan.cachedAnswer) {
            subResults.push({
                slot: slotPlan.id,
                facetKey: slotPlan.facetKey,
                label: slotPlan.label,
                hits: [],
                coverage: slotPlan.cachedAnswer.coverage,
                notes: null,
                cacheHit: true,
                facetAnswerCacheHit: true,
            });
            continue;
        }

        const fetched = active.subResults[activeIdx++];
        subResults.push({
            ...(fetched ?? {
                hits: [],
                coverage: "none" as const,
                notes: null,
                cacheHit: false,
            }),
            slot: slotPlan.id,
            facetKey: slotPlan.facetKey,
            label: slotPlan.label,
            facetAnswerCacheHit: false,
        });
    }

    const merged = mergeCompositeRetrieval(
        subResults.filter((s) => s.hits.length > 0)
    );

    return {
        subResults,
        cacheHits: active.cacheHits,
        merged,
    };
};
