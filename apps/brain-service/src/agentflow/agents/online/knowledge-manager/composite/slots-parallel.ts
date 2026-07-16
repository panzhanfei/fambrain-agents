import type { CompositeRetrievalSlot } from "@/agentflow/agents/online/intake-coordinator";
import { retrieveSlotWithCache } from "./retrieve-with-cache";
import {
    mergeCompositeRetrieval,
    type CompositeSubRetrieval,
} from "./merge";

/** 多分问 composite：各槽并行检索（hits 缓存 key 仍按槽独立） */
export const retrieveCompositeSlotsParallel = async (input: {
    corpusUserId: string;
    slots: CompositeRetrievalSlot[];
}): Promise<{
    subResults: CompositeSubRetrieval[];
    cacheHits: number;
    merged: ReturnType<typeof mergeCompositeRetrieval>;
}> => {
    const settled = await Promise.all(
        input.slots.map(async (slot) => {
            const { retrieval, cacheHit } = await retrieveSlotWithCache({
                corpusUserId: input.corpusUserId,
                slot,
            });
            const sub: CompositeSubRetrieval = {
                slot: slot.id,
                label: slot.label,
                hits: retrieval.hits,
                coverage: retrieval.coverage,
                notes: retrieval.notes,
                confidenceTier: retrieval.confidenceTier,
                enumerationMeta: retrieval.enumerationMeta,
                cacheHit,
            };
            return sub;
        })
    );
    const cacheHits = settled.filter((s) => s.cacheHit).length;
    return {
        subResults: settled,
        cacheHits,
        merged: mergeCompositeRetrieval(settled),
    };
};
