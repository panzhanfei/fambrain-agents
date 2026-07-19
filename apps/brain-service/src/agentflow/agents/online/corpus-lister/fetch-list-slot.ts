/**
 * 单槽 list_corpus 检索：目录扫盘分页，供 listRetriever 与 composite 混槽复用。
 */
import { resolveEnumerationTarget } from "@/agentflow/agents/online/intake-coordinator";
import type { CompositeRetrievalSlot } from "@/agentflow/agents/online/intake-coordinator";
import type { CompositeSubRetrieval } from "@/agentflow/agents/online/knowledge-manager";
import { retrieveEnumerationPage } from "./list";

export const fetchListSlot = async (
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
