import { resolveIncrementalCompositePlan } from "@/agentflow/brain-service/online/intake-coordinator";
import { retrieveKnowledge } from "@/agentflow/brain-service/online/knowledge-manager";
import type { PipelineGraphState } from "@/agentflow/pipeline/graph/state";
import {
    getRetrievalFromCache,
    setRetrievalCache,
} from "@fambrain/infra";
import { retrieveCompositeIncremental } from "../pipeline/retrieve-composite-incremental";

/** LangGraph retrieval 节点：单问 L2 cache + composite 增量检索 */
export const runRetrievalNode = async (
    state: PipelineGraphState
): Promise<Partial<PipelineGraphState>> => {
    const decision = state.decision;
    if (!decision) {
        return { error: "缺少入口路由决策" };
    }
    const fromRetry = !state.checkerPassed && state.retryCount < 1;
    const routeMode = decision.routeMode ?? "single";

    if (routeMode === "composite" || routeMode === "slot") {
        const slots = decision.compositeSlots ?? [];
        if (slots.length === 0) {
            return { error: "composite 路由缺少槽位定义" };
        }
        try {
            const incremental = await resolveIncrementalCompositePlan({
                session: {
                    conversationId: state.context.conversationId,
                    corpusUserId: state.context.corpusUserId,
                },
                userQuestion: state.userQuestion,
                slots,
            });
            const { subResults, cacheHits, merged } =
                await retrieveCompositeIncremental({
                    corpusUserId: state.context.corpusUserId,
                    plan: incremental,
                });
            return {
                hits: merged.hits,
                coverage: merged.coverage,
                notes: merged.notes,
                confidenceTier: merged.confidenceTier,
                compositeSubResults: subResults,
                compositeIncrementalPlan: incremental,
                compositeFacetCacheHits: incremental.facetCacheHits,
                retrievalCacheSlotHits: cacheHits,
                retrievalCacheHit:
                    incremental.activeRetrievalSlots.length > 0 &&
                    cacheHits === incremental.activeRetrievalSlots.length,
                retryCount: fromRetry ? state.retryCount + 1 : state.retryCount,
            };
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : "composite 检索失败";
            return {
                error: msg,
                retryCount: fromRetry ? state.retryCount + 1 : state.retryCount,
            };
        }
    }

    const searchQuery = decision.searchQuery || state.userQuestion;
    const queryType = decision.queryType ?? "default";
    const cacheKey = {
        corpusUserId: state.context.corpusUserId,
        searchQuery,
        queryType,
    };
    try {
        const cached = await getRetrievalFromCache(cacheKey);
        if (cached) {
            return {
                hits: cached.hits,
                coverage: cached.coverage,
                notes: cached.notes,
                confidenceTier: cached.confidenceTier ?? null,
                retrievalCacheHit: true,
                retrievalCacheSlotHits: null,
                compositeSubResults: null,
                retryCount: fromRetry ? state.retryCount + 1 : state.retryCount,
            };
        }
        const retrieval = await retrieveKnowledge({
            corpusUserId: state.context.corpusUserId,
            searchQuery,
            topics: decision.topics,
            subTasks: decision.subTasks,
            queryType: decision.queryType,
            candidates: [],
        });
        await setRetrievalCache(cacheKey, {
            hits: retrieval.hits,
            coverage: retrieval.coverage,
            notes: retrieval.notes,
            confidenceTier: retrieval.confidenceTier,
            confidenceScore: retrieval.confidenceScore,
        });
        return {
            hits: retrieval.hits,
            coverage: retrieval.coverage,
            notes: retrieval.notes,
            confidenceTier: retrieval.confidenceTier ?? null,
            retrievalCacheHit: false,
            retrievalCacheSlotHits: null,
            compositeSubResults: null,
            retryCount: fromRetry ? state.retryCount + 1 : state.retryCount,
        };
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : "知识库检索失败";
        return {
            error: msg,
            retryCount: fromRetry ? state.retryCount + 1 : state.retryCount,
        };
    }
};
