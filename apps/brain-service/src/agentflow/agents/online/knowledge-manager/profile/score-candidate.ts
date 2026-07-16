/**
 * EV-01：多维置信度 → high / mid / low 分档。
 */
import {
    CONFIDENCE_HIGH_MIN,
    CONFIDENCE_MID_MIN,
    CONFIDENCE_COALESCE_LOW_MIN,
} from "./km-config";
import type { RankedCandidate } from "../recall/retrieve-helpers";
import { getPathBoost, isPersonalResumePath } from "../recall/retrieve-helpers";
import type {
    ConfidenceTier,
    KnowledgeCandidate,
    KnowledgeHit,
    QueryProfile,
    RecallSource,
} from "../contract/types";

export type { ConfidenceTier };

export type ConfidenceInput = {
    queryProfile: QueryProfile;
    hits: KnowledgeHit[];
    ranked: RankedCandidate[];
    recallSource: RecallSource;
    topCandidate?: KnowledgeCandidate;
    guardApplied: boolean;
    fillApplied: boolean;
    candidateCount: number;
    expectedExperienceCount?: number;
};

export type ConfidenceAssessment = {
    tier: ConfidenceTier;
    score: number;
    top1Relevance: number;
    top1Top2Gap: number;
    fusionSignal: number;
    pathAuthority: number;
    reasons: string[];
};

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

const normalizeFusion = (fusionScore: number | undefined): number => {
    if (typeof fusionScore !== "number" || fusionScore <= 0) return 0;
    return clamp01(fusionScore * 25);
};

const recallSourceBoost = (source: RecallSource): number => {
    if (source === "hybrid") return 0.12;
    if (source === "vector" || source === "sparse") return 0.06;
    if (source === "provided") return 0.08;
    return 0;
};

const scoreToTier = (score: number): ConfidenceTier => {
    if (score >= CONFIDENCE_HIGH_MIN) return "high";
    if (score >= CONFIDENCE_MID_MIN) return "mid";
    return "low";
};

/** EV-01：融合分 + top1-top2 gap + path 权威 + recall 通道。 */
export const assessConfidence = (
    input: ConfidenceInput
): ConfidenceAssessment => {
    const reasons: string[] = [];
    const top1 = input.ranked[0];
    const top2 = input.ranked[1];
    const top1Relevance = top1?.relevance ?? input.hits[0]?.relevance ?? 0;
    const top1Top2Gap = top1
        ? top1.relevance - (top2?.relevance ?? 0)
        : 0;
    const fusionSignal = normalizeFusion(input.topCandidate?.fusionScore);
    const topPath = input.hits[0]?.path ?? top1?.path ?? "";
    const pathAuthority = clamp01(getPathBoost(topPath) * 2.5);
    const recallBoost = recallSourceBoost(input.recallSource);

    let score =
        0.42 * top1Relevance +
        0.18 * clamp01(top1Top2Gap * 6) +
        0.15 * fusionSignal +
        0.15 * pathAuthority +
        recallBoost;

    if (input.hits.length === 0) {
        return {
            tier: "low",
            score: 0,
            top1Relevance: 0,
            top1Top2Gap: 0,
            fusionSignal,
            pathAuthority,
            reasons: ["hits 为空"],
        };
    }

    if (
        input.queryProfile === "identity" &&
        input.hits.some((h) => isPersonalResumePath(h.path))
    ) {
        score = Math.max(score, CONFIDENCE_HIGH_MIN);
        reasons.push("identity+personal");
    }

    if (input.guardApplied) {
        score = Math.max(score, CONFIDENCE_HIGH_MIN - 0.05);
        reasons.push("identityGuard");
    }

    if (
        input.queryProfile === "enumeration" &&
        input.fillApplied &&
        input.expectedExperienceCount &&
        input.expectedExperienceCount > 0
    ) {
        const expHits = input.hits.filter(
            (h) =>
                h.path.includes("/experience/") && !/readme/i.test(h.path)
        ).length;
        if (expHits >= input.expectedExperienceCount) {
            score = Math.max(score, CONFIDENCE_HIGH_MIN);
            reasons.push("enumerationFill完整");
        } else if (expHits > 0) {
            score = Math.max(score, CONFIDENCE_MID_MIN);
            reasons.push("enumeration部分覆盖");
        }
    }

    if (top1Top2Gap >= 0.12) reasons.push("top1-top2 gap 大");
    if (fusionSignal >= 0.5) reasons.push("RRF 融合分高");
    if (input.recallSource === "hybrid") reasons.push("hybrid 双路");

    const tier = scoreToTier(score);
    return {
        tier,
        score: clamp01(score),
        top1Relevance,
        top1Top2Gap,
        fusionSignal,
        pathAuthority,
        reasons,
    };
};

/** EV-02：coverage 由分档推导，不再单看 token 比例。 */
export const deriveCoverageFromTier = (
    tier: ConfidenceTier,
    hits: KnowledgeHit[],
    topRelevance: number
): "sufficient" | "partial" | "none" => {
    if (hits.length === 0) return "none";
    if (tier === "high") return "sufficient";
    if (tier === "mid") {
        return topRelevance >= 0.72 ? "sufficient" : "partial";
    }
    return topRelevance >= 0.45 ? "partial" : "none";
};

/** EV-03：低置信且 top 极弱时不硬塞 Top1（D3-2 与中置信仍 coalesce）。 */
export const shouldCoalesceEmptyHits = (
    tier: ConfidenceTier,
    topRelevance: number
): boolean => {
    if (tier === "high" || tier === "mid") return true;
    return topRelevance >= CONFIDENCE_COALESCE_LOW_MIN;
};

export const tierNotes = (
    tier: ConfidenceTier,
    existing: string | null
): string | null => {
    const prefix =
        tier === "high"
            ? "高置信证据包。"
            : tier === "mid"
              ? "中置信证据包，部分覆盖。"
              : "低置信证据包，请谨慎引用。";
    if (!existing) return prefix;
    if (existing.includes("置信")) return existing;
    return `${prefix} ${existing}`;
};
