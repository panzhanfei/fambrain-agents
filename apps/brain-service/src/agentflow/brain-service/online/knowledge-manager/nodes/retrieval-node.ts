import {
  resolveIncrementalCompositePlan,
  retrieveCompositeIncremental,
} from "../composite";
import { resolveEnumerationTarget } from "@/agentflow/brain-service/online/intake-coordinator/composite/enumeration-target";
import { retrieveKnowledge } from "../recall/retrieve";
import { retrieveEnumerationPage } from "../list/retrieve-enumeration-page";
import type { PipelineGraphState } from "@/agentflow/pipeline/graph/state";
import {
  getRetrievalFromCache,
  setRetrievalCache,
  upsertEnumerationListSession,
} from "@fambrain/infra";

/**
 * 是否走「列举分页」专用路径。
 * Intake 已定：单槽 + enumeration + continue/exhaustive → 不走普通检索 hits 缓存。
 */
const isPaginatedEnumeration = (
  decision: NonNullable<PipelineGraphState["decision"]>
): boolean =>
  decision.routeMode === "single" &&
  decision.queryType === "enumeration" &&
  (decision.listIntent === "continue" || decision.listIntent === "exhaustive");

/**
 * LangGraph `retrieval` 节点（KM 入口）。
 *
 * 前置：Intake 已写好 `state.decision`；`routeAfterIntake` 判需要 KM 才进这里。
 * 后置：写出 hits / coverage / notes 等 → factChecker 或 contentSummarizer。
 *
 * 三条互斥分支（按优先级）：
 *   1. composite / slot — 多槽增量：先查会话「槽答案」缓存，未命中再并行 KM
 *   2. 列举分页        — continue/exhaustive，写 Redis 列举会话
 *   3. 单问默认        — 先查检索 hits 缓存，miss 再 retrieveKnowledge
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
  // factChecker 失败且尚未重试过 → 本轮算一次 retry
  const fromRetry = !state.checkerPassed && state.retryCount < 1;
  const routeMode = decision.routeMode ?? "single";

  // ── 分支 1：composite / slot（多问分槽）────────────────────────────
  // 例：「我叫什么？做过哪些项目？」→ 每槽独立检索，再 merge
  if (routeMode === "composite" || routeMode === "slot") {
    const slots = decision.compositeSlots ?? [];
    if (slots.length === 0) {
      return { error: "composite 路由缺少槽位定义" };
    }
    try {
      // 查会话「槽答案」缓存（Analyst 终稿），不是下面的检索 hits 缓存
      // 命中 → useCachedAnswer；未命中 → activeRetrievalSlots 真查 KM
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
        // 有活跃槽且全部命中 cache → 整轮算 cacheHit
        retrievalCacheHit:
          incremental.activeRetrievalSlots.length > 0 &&
          cacheHits === incremental.activeRetrievalSlots.length,
        retryCount: fromRetry ? state.retryCount + 1 : state.retryCount,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "composite 检索失败";
      return {
        error: msg,
        retryCount: fromRetry ? state.retryCount + 1 : state.retryCount,
      };
    }
  }

  // ── 分支 2：列举分页（「更多项目」/ 全量列举）──────────────────────
  // 用 Redis enumeration session 记 lastPage；不走单问 hits 缓存
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
      // 供下一轮「更多」续页
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
    } catch (e) {
      const msg = e instanceof Error ? e.message : "列举分页检索失败";
      return {
        error: msg,
        retryCount: fromRetry ? state.retryCount + 1 : state.retryCount,
      };
    }
  }

  // ── 分支 3：单问默认（城管技术 / 我的名字等）──────────────────────
  // 检索 hits 缓存 key = corpusUserId + searchQuery + queryType
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
    // cache miss → 真正进 KM（hybrid recall / fusion / profile）
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
    // 首屏 enumeration（非 continue）也记一页 session，方便后续「更多」
    const sessionKey = {
      conversationId: state.context.conversationId,
      corpusUserId: state.context.corpusUserId,
    };
    if (retrieval.enumerationMeta && decision.queryType === "enumeration") {
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
  } catch (e) {
    const msg = e instanceof Error ? e.message : "知识库检索失败";
    return {
      error: msg,
      retryCount: fromRetry ? state.retryCount + 1 : state.retryCount,
    };
  }
};
