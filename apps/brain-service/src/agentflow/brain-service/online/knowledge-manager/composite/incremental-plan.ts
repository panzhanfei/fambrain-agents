/**
 * Composite 增量计划（会话「槽答案」缓存）— KM 执行侧。
 *
 * 调用方：retrieval-node 在 routeMode=composite/slot 时。
 * 作用：对每个槽查会话里是否已有可复用的 Analyst 终稿；
 *       命中 → 本槽跳过真检索；未命中 → 进入 activeRetrievalSlots。
 *
 * 注意：这是「槽答案缓存」，不是 getRetrievalFromCache（那是检索 hits 缓存）。
 * 槽位列表本身由 Intake 规划；本文件只决定本轮哪些槽还要查。
 */
import {
    clearCompositeSession,
    getCompositeSession,
    isFacetAnswerReusable,
    type CachedFacetAnswer,
    type CompositeSessionKey,
} from "@fambrain/infra";
import type { InformationAnalystResult } from "@/agentflow/brain-service/online/information-analyst";
import type { CompositeRetrievalSlot } from "@/agentflow/brain-service/online/intake-coordinator/composite/composite-slot-queries";
import {
    attachFacetKey,
    detectCompositeRefreshIntent,
} from "./facet-key";

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

/** 缓存终稿 → Analyst 结果形状（供增量跳过 Analyst 时复用） */
export const cachedFacetToAnalystResult = (
    cached: CachedFacetAnswer
): InformationAnalystResult => ({
    answer: cached.answer,
    citations: cached.citations,
    confidence: cached.confidence,
    insufficientEvidence: cached.insufficientEvidence,
    blocks: cached.blocks,
});

/** 从 Analyst blocks 抽出列举分页元数据，写入 facet cache */
const enumBlockFromResult = (
    result: InformationAnalystResult
): { page?: number; total?: number; listKind?: "project" | "experience" } => {
    const block = result.blocks?.find((b) => b.type === "enumeration");
    if (!block || block.type !== "enumeration") return {};
    return {
        page: block.page,
        total: block.total,
        listKind: block.listKind === "employer" ? "experience" : "project",
    };
};

/** Analyst 结果 → 可写入会话的 CachedFacetAnswer */
export const analystResultToCachedFacet = (
    facetKey: string,
    label: string,
    result: InformationAnalystResult,
    coverage: CachedFacetAnswer["coverage"]
): CachedFacetAnswer => {
    const meta = enumBlockFromResult(result);
    return {
        facetKey,
        label,
        answer: result.answer,
        citations: result.citations,
        coverage,
        insufficientEvidence: result.insufficientEvidence,
        confidence: result.confidence,
        cachedAt: Date.now(),
        blocks: result.blocks,
        enumerationPage: meta.page,
        enumerationTotal: meta.total,
        listKind: meta.listKind,
    };
};

/**
 * 解析本次 composite 增量计划：哪些槽可跳过真检索。
 *
 * 流程：
 * 1. 用户说「重新来」等 → 清空会话 facet cache
 * 2. 读会话 snapshot.facets
 * 3. 每槽 attachFacetKey，可复用则计入 facetCacheHits，否则进 activeRetrievalSlots
 */
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
