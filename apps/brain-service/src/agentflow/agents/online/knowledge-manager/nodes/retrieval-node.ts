import {
  mergeCompositeRetrieval,
  resolveIncrementalCompositePlan,
  retrieveCompositeIncremental,
  type CompositeSubRetrieval,
} from "../composite";
import { fetchListSlot } from "@/agentflow/agents/online/corpus-lister/fetch-list-slot";
import type { PipelineGraphState } from "@/agentflow/pipeline/graph/state";
import { upsertEnumerationListSession } from "@fambrain/infra";

/**
 * KM 检索节点（planExecutor 内）：km_retrieve 槽 + composite 混槽时的 list 槽。
 *
 * 纯 list（UI 分页 / exhaustive / continue）走图节点 listRetriever，不经此节点。
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
