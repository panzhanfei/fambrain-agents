/**
 * KM composite（执行侧）类型约定。
 */
import type { CachedFacetAnswer } from "@fambrain/infra";
import type {
    CompositeRetrievalSlot,
    CompositeSlotId,
} from "@/agentflow/brain-service/online/intake-coordinator";
import type {
    ConfidenceTier,
    EnumerationMeta,
    KnowledgeHit,
    KnowledgeRetrievalResult,
} from "../contract/types";

/** 单槽计划：原槽位 + facetKey + 是否复用缓存答案 */
export type CompositeSlotPlan = CompositeRetrievalSlot & {
    facetKey: string;
    useCachedAnswer: boolean;
    cachedAnswer: CachedFacetAnswer | null;
};

/**
 * 增量检索计划。
 * - slots：全部槽（含命中/未命中标记）
 * - activeRetrievalSlots：需要真正调 retrieveKnowledge 的子集
 */
export type IncrementalCompositePlan = {
    slots: CompositeSlotPlan[];
    activeRetrievalSlots: CompositeRetrievalSlot[];
    facetCacheHits: number;
    sessionCleared: boolean;
};

export type CompositeSubRetrieval = {
    slot: CompositeSlotId;
    /** facet 稳定键 */
    facetKey?: string;
    label: string;
    hits: KnowledgeHit[];
    coverage: KnowledgeRetrievalResult["coverage"];
    notes: string | null;
    confidenceTier?: ConfidenceTier;
    enumerationMeta?: EnumerationMeta;
    cacheHit: boolean;
    /** 槽答案缓存命中（跳过真检索 + Analyst） */
    facetAnswerCacheHit?: boolean;
};

export type CompositeRetrievePlan = {
    slots: CompositeRetrievalSlot[];
};
