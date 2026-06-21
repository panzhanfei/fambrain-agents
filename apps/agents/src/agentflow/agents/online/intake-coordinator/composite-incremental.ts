/**
 * L4：composite 增量 — 会话 facet 终稿 cache 命中则跳过 KM + Analyst。
 */
import {
    clearCompositeSession,
    getCompositeSession,
    isFacetAnswerReusable,
    type CachedFacetAnswer,
    type CompositeSessionKey,
} from "@fambrain/infra";
import type { InformationAnalystResult } from "@/agentflow/agents/online/information-analyst";
import {
    attachFacetKey,
    detectCompositeRefreshIntent,
} from "./composite-facet-key";
import type { CompositeRetrievalSlot } from "./composite-slot-queries";

export type CompositeSlotPlan = CompositeRetrievalSlot & {
    facetKey: string;
    useCachedAnswer: boolean;
    cachedAnswer: CachedFacetAnswer | null;
};

export type IncrementalCompositePlan = {
    slots: CompositeSlotPlan[];
    activeRetrievalSlots: CompositeRetrievalSlot[];
    facetCacheHits: number;
    sessionCleared: boolean;
};

export const cachedFacetToAnalystResult = (
    cached: CachedFacetAnswer
): InformationAnalystResult => ({
    answer: cached.answer,
    citations: cached.citations,
    confidence: cached.confidence,
    insufficientEvidence: cached.insufficientEvidence,
});

export const analystResultToCachedFacet = (
    facetKey: string,
    label: string,
    result: InformationAnalystResult,
    coverage: CachedFacetAnswer["coverage"]
): CachedFacetAnswer => ({
    facetKey,
    label,
    answer: result.answer,
    citations: result.citations,
    coverage,
    insufficientEvidence: result.insufficientEvidence,
    confidence: result.confidence,
    cachedAt: Date.now(),
});

export const resolveIncrementalCompositePlan = async (input: {
    session: CompositeSessionKey;
    userQuestion: string;
    slots: CompositeRetrievalSlot[];
}): Promise<IncrementalCompositePlan> => {
    let sessionCleared = false;
    if (detectCompositeRefreshIntent(input.userQuestion)) {
        await clearCompositeSession(input.session);
        sessionCleared = true;
    }

    const snapshot = sessionCleared
        ? null
        : await getCompositeSession(input.session);

    const slots: CompositeSlotPlan[] = [];
    const activeRetrievalSlots: CompositeRetrievalSlot[] = [];
    let facetCacheHits = 0;

    for (const slot of input.slots) {
        const withKey = attachFacetKey(slot);
        const cached = snapshot?.facets[withKey.facetKey] ?? null;
        const useCachedAnswer = isFacetAnswerReusable(cached);
        if (useCachedAnswer) facetCacheHits++;

        const plan: CompositeSlotPlan = {
            ...withKey,
            useCachedAnswer,
            cachedAnswer: useCachedAnswer ? cached : null,
        };
        slots.push(plan);
        if (!useCachedAnswer) {
            activeRetrievalSlots.push(slot);
        }
    }

    return {
        slots,
        activeRetrievalSlots,
        facetCacheHits,
        sessionCleared,
    };
};
