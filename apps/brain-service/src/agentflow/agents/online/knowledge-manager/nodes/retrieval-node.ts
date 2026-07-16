import {
  mergeCompositeRetrieval,
  resolveIncrementalCompositePlan,
  retrieveCompositeIncremental,
  type CompositeSubRetrieval,
} from "../composite";
import { resolveEnumerationTarget } from "@/agentflow/agents/online/intake-coordinator";
import type { CompositeRetrievalSlot } from "@/agentflow/agents/online/intake-coordinator";
import { retrieveEnumerationPage } from "../list/retrieve-enumeration-page";
import type { PipelineGraphState } from "@/agentflow/pipeline/graph/state";
import { upsertEnumerationListSession } from "@fambrain/infra";

const fetchListSlot = async (
  slot: CompositeRetrievalSlot,
  corpusUserId: string,
  asOfDate?: string | null
): Promise<CompositeSubRetrieval> => {
  const listKind =
    slot.enumerationControl?.listKind ??
    resolveEnumerationTarget({
      label: slot.label,
      searchQuery: slot.searchQuery,
      topics: slot.topics,
      subTasks: slot.subTasks,
      listKind: slot.enumerationControl?.listKind ?? null,
    });
  const page = slot.enumerationPage ?? 1;
  const pageSize = slot.enumerationPageSize ?? 20;
  const retrieval = await retrieveEnumerationPage({
    corpusUserId,
    listKind,
    page,
    pageSize,
    timeWindowYears: slot.enumerationControl?.timeWindowYears ?? null,
    asOfDate,
  });
  return {
    slot: slot.id,
    facetKey: `list:${listKind}:p${page}`,
    label: slot.label,
    hits: retrieval.hits,
    coverage: retrieval.coverage,
    notes: retrieval.notes,
    confidenceTier: retrieval.confidenceTier ?? null,
    enumerationMeta: retrieval.enumerationMeta ?? null,
    cacheHit: false,
    facetAnswerCacheHit: false,
  };
};

/**
 * LangGraph `retrieval` 节点：按槽执行数据获取。
 *
 * - executor=km_retrieve（默认）→ hybrid / composite 增量
 * - executor=list_corpus → 目录扫盘分页（retrieveEnumerationPage）
 * - 同一轮可混搭多槽
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

  // 兼容旧 routeMode=list：视为单槽 list_corpus
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
        compositeSubResults: [
          {
            slot: "list-0",
            facetKey: `list:${listKind}:p${page}`,
            label: listKind === "project" ? "项目经历" : "工作经历",
            hits: retrieval.hits,
            coverage: retrieval.coverage,
            notes: retrieval.notes,
            confidenceTier: retrieval.confidenceTier ?? null,
            enumerationMeta: retrieval.enumerationMeta ?? null,
            cacheHit: false,
            facetAnswerCacheHit: false,
          },
        ],
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

  if (routeMode === "slots") {
    const slots = decision.compositeSlots ?? [];
    if (slots.length === 0) {
      return { error: "slots 路由缺少槽位定义" };
    }

    const listSlots = slots.filter((s) => s.executor === "list_corpus");
    const kmSlots = slots.filter((s) => s.executor !== "list_corpus");

    try {
      const sessionKey = {
        conversationId: state.context.conversationId,
        corpusUserId: state.context.corpusUserId,
      };

      let kmSubResults: CompositeSubRetrieval[] = [];
      let cacheHits = 0;
      let incremental: Awaited<
        ReturnType<typeof resolveIncrementalCompositePlan>
      > | null = null;

      if (slots.length > 0) {
        incremental = await resolveIncrementalCompositePlan({
          session: sessionKey,
          userQuestion: state.userQuestion,
          slots,
        });
      }

      if (kmSlots.length > 0 && incremental) {
        const kmFetched = await retrieveCompositeIncremental({
          corpusUserId: state.context.corpusUserId,
          plan: incremental,
        });
        kmSubResults = kmFetched.subResults;
        cacheHits = kmFetched.cacheHits;
      }

      const listSubResults = await Promise.all(
        listSlots.map((slot) =>
          fetchListSlot(
            slot,
            state.context.corpusUserId,
            state.asOfDate ?? null
          )
        )
      );

      for (const sub of listSubResults) {
        const meta = sub.enumerationMeta;
        if (!meta) continue;
        await upsertEnumerationListSession(
          sessionKey,
          meta.listKind,
          {
            lastPage: meta.page,
            pageSize: meta.pageSize,
            total: meta.totalExpected,
          }
        ).catch(() => undefined);
      }

      // 按原 slots 顺序合并 subResults
      const byId = new Map<string, CompositeSubRetrieval>();
      for (const s of [...kmSubResults, ...listSubResults]) {
        byId.set(String(s.slot), s);
      }
      const subResults: CompositeSubRetrieval[] = slots.map((slot, i) => {
        const found = byId.get(String(slot.id));
        if (found) return found;
        return {
          slot: slot.id,
          facetKey: `empty:${i}`,
          label: slot.label,
          hits: [],
          coverage: "none" as const,
          notes: null,
          cacheHit: false,
          facetAnswerCacheHit: false,
        };
      });

      const merged = mergeCompositeRetrieval(subResults);
      const enumerationMeta =
        subResults.find((s) => s.enumerationMeta)?.enumerationMeta ?? null;

      if (
        enumerationMeta &&
        listSlots.length === 0 &&
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
        compositeFacetCacheHits: incremental?.facetCacheHits ?? 0,
        retrievalCacheSlotHits: cacheHits,
        retrievalCacheHit:
          Boolean(incremental) &&
          incremental!.activeRetrievalSlots.length > 0 &&
          cacheHits === incremental!.activeRetrievalSlots.length,
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
