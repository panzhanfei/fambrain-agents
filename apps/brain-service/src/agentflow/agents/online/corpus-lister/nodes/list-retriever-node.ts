/**
 * LangGraph listRetriever 节点：纯列举分页（UI 短路 / exhaustive / continue）。
 * 跳过 planExecutor、FC、tool 编排。
 */
import { logAgentOut } from "@fambrain/brain-shared/agent-log";
import { upsertEnumerationListSession } from "@fambrain/infra";
import { mergeCompositeRetrieval } from "@/agentflow/agents/online/knowledge-manager";
import type { PipelineGraphState } from "@/agentflow/pipeline/graph/state";
import { fetchListSlot } from "../fetch-list-slot";

export const runListRetrieverNode = async (
    state: PipelineGraphState
): Promise<Partial<PipelineGraphState>> => {
    const decision = state.decision;
    if (!decision) {
        return { error: "缺少入口路由决策" };
    }

    const slots = decision.compositeSlots ?? [];
    if (slots.length === 0) {
        return { error: "纯 list 路由缺少槽位定义" };
    }

    logAgentOut("ListRetriever", "进入", {
        slotCount: slots.length,
        listKinds: slots.map(
            (s) => s.enumerationControl?.listKind ?? s.label
        ),
    });

    const sessionKey = {
        conversationId: state.context.conversationId,
        corpusUserId: state.context.corpusUserId,
    };

    try {
        const subResults = await Promise.all(
            slots.map((slot) =>
                fetchListSlot(
                    slot,
                    state.context.corpusUserId,
                    state.asOfDate ?? null
                )
            )
        );

        for (const sub of subResults) {
            const meta = sub.enumerationMeta;
            if (!meta) continue;
            await upsertEnumerationListSession(sessionKey, meta.listKind, {
                lastPage: meta.page,
                pageSize: meta.pageSize,
                total: meta.totalExpected,
            }).catch(() => undefined);
        }

        const merged = mergeCompositeRetrieval(subResults);
        const enumerationMeta =
            subResults.find((s) => s.enumerationMeta)?.enumerationMeta ?? null;

        logAgentOut("ListRetriever", "完成", {
            hitCount: merged.hits.length,
            coverage: merged.coverage,
            page: enumerationMeta?.page ?? null,
            hasMore: enumerationMeta?.hasMore ?? null,
        });

        return {
            hits: merged.hits,
            coverage: merged.coverage,
            notes: merged.notes,
            confidenceTier: merged.confidenceTier,
            enumerationMeta,
            compositeSubResults: subResults,
            compositeIncrementalPlan: null,
            retrievalCacheHit: false,
            retrievalCacheSlotHits: null,
            checkerPassed: true,
        };
    } catch (e) {
        const msg = e instanceof Error ? e.message : "列举分页检索失败";
        return { error: msg };
    }
};
