import { resolveIncrementalCompositePlan } from "@/agentflow/brain-service/online/intake-coordinator";
import { resolveEnumerationTarget } from "@/agentflow/brain-service/online/intake-coordinator/composite/enumeration-target";
import { retrieveKnowledge } from "@/agentflow/brain-service/online/knowledge-manager";
import { retrieveEnumerationPage } from "@/agentflow/brain-service/online/knowledge-manager/list/retrieve-enumeration-page";
import type { PipelineGraphState } from "@/agentflow/pipeline/graph/state";
import {
    getRetrievalFromCache,
    setRetrievalCache,
    upsertEnumerationListSession,
} from "@fambrain/infra";
import { retrieveCompositeIncremental } from "../pipeline/retrieve-composite-incremental";

const isPaginatedEnumeration = (
    decision: NonNullable<PipelineGraphState["decision"]>
): boolean =>
    decision.routeMode === "single" &&
    decision.queryType === "enumeration" &&
    (decision.listIntent === "continue" || decision.listIntent === "exhaustive");

/** LangGraph retrieval 节点：单问 L2 cache + composite 增量检索 + 列举分页 */
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

    if (isPaginatedEnumeration(decision)) {
        const listKind =
            decision.enumerationListKind ??
            resolveEnumerationTarget({
                label: state.userQuestion,
                searchQuery: decision.searchQuery,
                topics: decision.topics,
                subTasks: decision.subTasks,
            });
        const page = decision.enumerationPage ?? 1;
        const pageSize = decision.enumerationPageSize ?? 20;
        try {
            const retrieval = await retrieveEnumerationPage({
                corpusUserId: state.context.corpusUserId,
                listKind,
                page,
                pageSize,
            });
            await upsertEnumerationListSession(
                {
                    conversationId: state.context.conversationId,
                    corpusUserId: state.context.corpusUserId,
                },
                listKind,
                {
                    lastPage: page,
                    pageSize,
                    total: retrieval.enumerationMeta?.totalExpected ?? 0,
                }
            );
            return {
                hits: retrieval.hits,
                coverage: retrieval.coverage,
                notes: retrieval.notes,
                confidenceTier: retrieval.confidenceTier ?? null,
                enumerationMeta: retrieval.enumerationMeta ?? null,
                retrievalCacheHit: false,
                retrievalCacheSlotHits: null,
                compositeSubResults: null,
                retryCount: fromRetry ? state.retryCount + 1 : state.retryCount,
            };
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : "列举分页检索失败";
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
        const sessionKey = {
            conversationId: state.context.conversationId,
            corpusUserId: state.context.corpusUserId,
        };
        if (
            retrieval.enumerationMeta &&
            decision.queryType === "enumeration"
        ) {
            await upsertEnumerationListSession(
                sessionKey,
                retrieval.enumerationMeta.listKind,
                {
                    lastPage: 1,
                    pageSize: retrieval.hits.length,
                    total: retrieval.enumerationMeta.totalExpected,
                }
            ).catch(() => undefined);
        }
        return {
            hits: retrieval.hits,
            coverage: retrieval.coverage,
            notes: retrieval.notes,
            confidenceTier: retrieval.confidenceTier ?? null,
            enumerationMeta: retrieval.enumerationMeta ?? null,
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
