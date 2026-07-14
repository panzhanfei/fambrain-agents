import type {
    KnowledgeHit,
    KnowledgeRetrievalResult,
    ConfidenceTier,
} from "../contract/types";
import type { CompositeSubRetrieval } from "./interface";

export type {
    CompositeRetrievePlan,
    CompositeSubRetrieval,
} from "./interface";

const mergeCoverage = (
    coverages: KnowledgeRetrievalResult["coverage"][]
): KnowledgeRetrievalResult["coverage"] => {
    if (coverages.length === 0) return "none";
    if (coverages.every((c) => c === "none")) return "none";
    if (coverages.every((c) => c === "sufficient")) return "sufficient";
    return "partial";
};

const tierRank: Record<ConfidenceTier, number> = {
    high: 3,
    mid: 2,
    low: 1,
};

export const mergeCompositeHits = (
    subResults: CompositeSubRetrieval[],
    maxHits = 16
): KnowledgeHit[] => {
    const byPath = new Map<string, KnowledgeHit>();
    for (const sub of subResults) {
        for (const hit of sub.hits) {
            const prev = byPath.get(hit.path);
            if (!prev || hit.relevance > prev.relevance) {
                byPath.set(hit.path, hit);
            }
        }
    }
    return [...byPath.values()]
        .sort((a, b) => b.relevance - a.relevance)
        .slice(0, maxHits);
};

export const mergeCompositeRetrieval = (
    subResults: CompositeSubRetrieval[]
): {
    hits: KnowledgeHit[];
    coverage: KnowledgeRetrievalResult["coverage"];
    notes: string | null;
    confidenceTier: ConfidenceTier | null;
} => {
    const hits = mergeCompositeHits(subResults);
    const coverage = mergeCoverage(subResults.map((s) => s.coverage));
    const notesParts = subResults
        .map((s) => s.notes?.trim())
        .filter((n): n is string => Boolean(n));
    const tiers = subResults
        .map((s) => s.confidenceTier)
        .filter((t): t is ConfidenceTier => Boolean(t));
    const confidenceTier =
        tiers.length === 0
            ? null
            : tiers.reduce((best, t) => (tierRank[t] > tierRank[best] ? t : best));
    return {
        hits,
        coverage: hits.length === 0 ? "none" : coverage,
        notes: notesParts.length > 0 ? notesParts.join(" ") : null,
        confidenceTier,
    };
};
