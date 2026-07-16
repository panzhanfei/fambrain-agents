import type { CompositeRetrievalSlot } from "@/agentflow/agents/online/intake-coordinator";
import { retrieveKnowledge } from "../recall/retrieve";
import type { KnowledgeRetrievalResult } from "../contract/types";
import {
    getRetrievalFromCache,
    setRetrievalCache,
} from "@fambrain/infra";

/** 单槽检索：先查 hits 缓存，miss 再 retrieveKnowledge（单问与 composite 槽共用） */
export const retrieveSlotWithCache = async (input: {
    corpusUserId: string;
    slot: CompositeRetrievalSlot;
}): Promise<{ retrieval: KnowledgeRetrievalResult; cacheHit: boolean }> => {
    const cacheKey = {
        corpusUserId: input.corpusUserId,
        searchQuery: input.slot.searchQuery,
        queryType: input.slot.queryType,
    };
    const cached = await getRetrievalFromCache(cacheKey);
    if (cached) {
        return {
            retrieval: {
                hits: cached.hits,
                coverage: cached.coverage,
                notes: cached.notes,
                confidenceTier: cached.confidenceTier,
                confidenceScore: cached.confidenceScore,
            },
            cacheHit: true,
        };
    }
    const retrieval = await retrieveKnowledge({
        corpusUserId: input.corpusUserId,
        searchQuery: input.slot.searchQuery,
        topics: input.slot.topics,
        subTasks: input.slot.subTasks,
        queryType: input.slot.queryType,
        candidates: [],
    });
    await setRetrievalCache(cacheKey, {
        hits: retrieval.hits,
        coverage: retrieval.coverage,
        notes: retrieval.notes,
        confidenceTier: retrieval.confidenceTier,
        confidenceScore: retrieval.confidenceScore,
    });
    return { retrieval, cacheHit: false };
};
