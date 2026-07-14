import {
  resolveIncrementalCompositePlan,
  retrieveCompositeIncremental,
} from "../composite";
import { resolveEnumerationTarget } from "@/agentflow/brain-service/online/intake-coordinator";
import { retrieveEnumerationPage } from "../list/retrieve-enumeration-page";
import type { PipelineGraphState } from "@/agentflow/pipeline/graph/state";
import { upsertEnumerationListSession } from "@fambrain/infra";

/**
 * LangGraph `retrieval` 节点（KM 入口）。
 *
 * 两条互斥分支（按优先级）：
 *   1. list — 列举分页（continue/exhaustive），list API
 *   2. slots — 1～N 槽：facet 增量 + 并行 KM + merge
 *
 * `fromRetry`：factChecker 未通过时会再进本节点一次；此时递增 retryCount。
 */
export const runRetrievalNode = async (
  state: PipelineGraphState
): Promise<Partial<PipelineGraphState>> => {
  const decision = state.decision;
  if (!decision) {
    return { error: "缺少入口路由决策" };
  }
  const fromRetry = !state.checkerPassed && state.retryCount < 1;
  const routeMode = decision.routeMode ?? "skip";

  // ── 分支 1：列举分页（list）────────────────────────────────────────
  if (
    routeMode === "list" &&
    (decision.listIntent === "continue" ||
      decision.listIntent === "exhaustive")
  ) {
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
        compositeIncrementalPlan: null,
        retryCount: fromRetry ? state.retryCount + 1 : state.retryCount,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "列举分页检索失败";
      return {
        error: msg,
        retryCount: fromRetry ? state.retryCount + 1 : state.retryCount,
      };
    }
  }

  // ── 分支 2：slots（1～N 槽 vector 检索）────────────────────────────
  if (routeMode === "slots") {
    const slots = decision.compositeSlots ?? [];
    if (slots.length === 0) {
      return { error: "slots 路由缺少槽位定义" };
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

      const enumerationMeta =
        subResults.find((s) => s.enumerationMeta)?.enumerationMeta ?? null;

      const sessionKey = {
        conversationId: state.context.conversationId,
        corpusUserId: state.context.corpusUserId,
      };
      if (
        enumerationMeta &&
        decision.queryType === "enumeration" &&
        decision.listIntent !== "continue" &&
        decision.listIntent !== "exhaustive"
      ) {
        await upsertEnumerationListSession(
          sessionKey,
          enumerationMeta.listKind,
          {
            lastPage: 1,
            pageSize: subResults[0]?.hits.length ?? merged.hits.length,
            total: enumerationMeta.totalExpected,
          }
        ).catch(() => undefined);
      }

      return {
        hits: merged.hits,
        coverage: merged.coverage,
        notes: merged.notes,
        confidenceTier: merged.confidenceTier,
        enumerationMeta,
        compositeSubResults: subResults,
        compositeIncrementalPlan: incremental,
        compositeFacetCacheHits: incremental.facetCacheHits,
        retrievalCacheSlotHits: cacheHits,
        retrievalCacheHit:
          incremental.activeRetrievalSlots.length > 0 &&
          cacheHits === incremental.activeRetrievalSlots.length,
        retryCount: fromRetry ? state.retryCount + 1 : state.retryCount,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "知识库检索失败";
      return {
        error: msg,
        retryCount: fromRetry ? state.retryCount + 1 : state.retryCount,
      };
    }
  }

  return { error: `不支持的 routeMode: ${routeMode}` };
};
