import type { KnowledgeRetrievalResult } from "@/agentflow/agents/online/knowledge-manager";
import {
    corpusEntryToHit,
    listCorpusEntriesPage,
    type CorpusListKind,
} from "./list-corpus-entries";

export const retrieveEnumerationPage = async (input: {
    corpusUserId: string;
    listKind: CorpusListKind;
    page: number;
    pageSize: number;
    timeWindowYears?: number | null;
    asOfDate?: string | null;
}): Promise<KnowledgeRetrievalResult> => {
    const pageResult = await listCorpusEntriesPage(input);
    const hits = pageResult.items.map(corpusEntryToHit);
    const entityLabel = input.listKind === "project" ? "项目" : "经历";
    const coverage =
        pageResult.total === 0
            ? "none"
            : hits.length >= pageResult.total
              ? "sufficient"
              : "partial";
    const notes =
        pageResult.total === 0
            ? `语料中未找到${entityLabel}条目。`
            : `列举分页 ${pageResult.page}：${hits.length}/${pageResult.total} 个${entityLabel}`;
    return {
        hits,
        coverage,
        notes,
        confidenceTier: hits.length > 0 ? "high" : "low",
        confidenceScore: hits.length > 0 ? 0.85 : 0.2,
        enumerationMeta: {
            listKind: input.listKind,
            totalExpected: pageResult.total,
            shown: hits.length,
            page: pageResult.page,
            pageSize: pageResult.pageSize,
            hasMore: pageResult.hasMore,
        },
    };
};
