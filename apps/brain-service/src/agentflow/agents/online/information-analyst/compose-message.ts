/**
 * 助手消息 Composer：列举型 deterministic 列表 + composite 分段 blocks。
 */
import type {
    AssistantMessageBlock,
    AssistantMessagePayload,
    EnumerationListItem,
} from "@fambrain/brain-types";
import type { KnowledgeHit } from "@/agentflow/agents/online/knowledge-manager";
import type { EnumerationMeta } from "@/agentflow/agents/online/knowledge-manager";
import { isProjectEnumeration } from "@/agentflow/agents/online/intake-coordinator";
import { enumerationActionPrompt } from "@/agentflow/agents/online/intake-coordinator/enumeration-action-prompts";
import { formatSubQuestionSection } from "./analyze-helpers";
import {
    enumerationStartIndex,
    formatEnumerationPaginationHint,
    formatEnumerationPaginationLine,
    formatHitsAsAnswerList,
    hitDisplayTitle,
} from "./enumeration-format";
import type { InformationAnalystResult } from "./prompt";

export type ComposeEnumerationInput = {
    hits: KnowledgeHit[];
    language: "zh" | "en" | "mixed";
    topics?: string[];
    label?: string;
    enumerationMeta?: EnumerationMeta | null;
    notes?: string | null;
    listIntent?: "preview" | "continue" | "exhaustive" | null;
};

const hitToListItem = (hit: KnowledgeHit): EnumerationListItem => ({
    id: hit.path,
    title: hitDisplayTitle(hit),
    path: hit.path,
});

const resolveListKind = (
    topics: string[] = [],
    meta?: EnumerationMeta | null
): "project" | "employer" => {
    if (meta?.listKind === "project") return "project";
    if (meta?.listKind === "experience") return "employer";
    if (
        isProjectEnumeration({
            label: "",
            searchQuery: "",
            topics,
        })
    ) {
        return "project";
    }
    return "employer";
};

const parseTotalsFromNotes = (
    notes: string | null | undefined
): { shown: number; total: number } | null => {
    if (!notes) return null;
    const m = notes.match(/(\d+)\/(\d+)\s*个/);
    if (!m) return null;
    return { shown: Number(m[1]), total: Number(m[2]) };
};

export const buildEnumerationFooter = (
    input: ComposeEnumerationInput,
    listKind: "project" | "employer"
): string => {
    const meta = input.enumerationMeta;
    const parsed = parseTotalsFromNotes(input.notes);
    const total = meta?.totalExpected ?? parsed?.total ?? input.hits.length;
    const shown = input.hits.length;
    const page = meta?.page ?? 1;
    const pageSize = meta?.pageSize ?? shown;
    const startIndex = enumerationStartIndex({ page, pageSize });
    const hasMore = meta?.hasMore ?? total > shown;
    return formatEnumerationPaginationHint({
        language: input.language,
        listKind,
        total,
        shown,
        page,
        pageSize,
        startIndex,
        hasMore,
        listIntent: input.listIntent,
    });
};

export const buildEnumerationBlock = (
    input: ComposeEnumerationInput
): AssistantMessageBlock => {
    const listKind = resolveListKind(input.topics, input.enumerationMeta);
    const projectHits =
        listKind === "project"
            ? input.hits.filter((h) =>
                  h.path.replace(/\\/g, "/").toLowerCase().includes("/projects/")
              )
            : input.hits;
    const hitsForList =
        listKind === "project" && projectHits.length > 0
            ? projectHits
            : input.hits;
    const meta = input.enumerationMeta;
    const parsed = parseTotalsFromNotes(input.notes);
    const total = meta?.totalExpected ?? parsed?.total ?? hitsForList.length;
    const shown = hitsForList.length;
    const page = meta?.page ?? 1;
    const pageSize = meta?.pageSize ?? shown;
    const hasMore = meta?.hasMore ?? total > shown;
    const startIndex = enumerationStartIndex({ page, pageSize });
    const paginationHint = formatEnumerationPaginationLine({
        language: input.language,
        listKind,
        total,
        shown,
        page,
        pageSize,
        startIndex,
        hasMore,
        listIntent: input.listIntent,
    });
    return {
        type: "enumeration",
        listKind,
        items: hitsForList.map(hitToListItem),
        total,
        shown,
        page,
        pageSize,
        hasMore,
        startIndex,
        paginationHint: paginationHint || undefined,
    };
};

export const buildEnumerationActionsBlock = (
    listKind: "project" | "employer",
    hasMore: boolean,
    listIntent?: "preview" | "continue" | "exhaustive" | null
): AssistantMessageBlock | null => {
    if (!hasMore) return null;
    const paginated =
        listIntent === "exhaustive" || listIntent === "continue";
    const kind = listKind === "project" ? "project" : "experience";
    const prompt = enumerationActionPrompt(
        kind,
        paginated ? "continue" : "exhaustive"
    );
    return {
        type: "actions",
        actions: [
            {
                id: "list_more",
                label:
                    listKind === "project"
                        ? paginated
                            ? "下一页（更多项目）"
                            : "列出全部项目（分页）"
                        : paginated
                          ? "下一页（更多经历）"
                          : "列出全部经历（分页）",
                prompt,
            },
        ],
    };
};

export const composeEnumerationAnswer = (
    input: ComposeEnumerationInput
): InformationAnalystResult & { blocks: AssistantMessageBlock[] } => {
    const listKind = resolveListKind(input.topics, input.enumerationMeta);
    let hitsForAnswer = input.hits;
    if (listKind === "project") {
        const projectHits = input.hits.filter((h) =>
            h.path.replace(/\\/g, "/").toLowerCase().includes("/projects/")
        );
        if (projectHits.length > 0) hitsForAnswer = projectHits;
    }
    const enumerationBlock = buildEnumerationBlock(input);
    const footer = buildEnumerationFooter(input, listKind);
    const startIndex =
        enumerationBlock.type === "enumeration"
            ? (enumerationBlock.startIndex ??
              enumerationStartIndex({
                  page: enumerationBlock.page,
                  pageSize: enumerationBlock.pageSize,
              }))
            : 1;
    const answer = `${formatHitsAsAnswerList(hitsForAnswer, input.language, startIndex)}${footer}`;
    const blocks: AssistantMessageBlock[] = [enumerationBlock];
    const actions = buildEnumerationActionsBlock(
        listKind,
        enumerationBlock.hasMore,
        input.listIntent
    );
    if (actions) blocks.push(actions);
    return {
        answer,
        citations: hitsForAnswer.map((h) => ({
            path: h.path,
            excerpt: h.excerpt,
        })),
        confidence: input.hits.length > 0 ? 0.75 : 0.5,
        insufficientEvidence: input.hits.length === 0,
        blocks,
    };
};

export const sectionBlocksFromResult = (
    sectionNo: number,
    label: string,
    result: InformationAnalystResult
): AssistantMessageBlock[] => {
    const blocks: AssistantMessageBlock[] = [
        { type: "heading", text: label, sectionNo },
    ];
    if (result.blocks?.length) {
        blocks.push(...result.blocks);
        return blocks;
    }
    blocks.push({ type: "text", markdown: result.answer.trim() });
    return blocks;
};

export const mergeCompositePayload = (
    sections: Array<{
        order: number;
        label: string;
        result: InformationAnalystResult;
    }>
): AssistantMessagePayload => {
    const sorted = [...sections].sort((a, b) => a.order - b.order);
    const blocks: AssistantMessageBlock[] = [];
    for (let i = 0; i < sorted.length; i++) {
        const s = sorted[i]!;
        blocks.push(...sectionBlocksFromResult(i + 1, s.label, s.result));
    }
    const plainText = sorted
        .map((s, i) => formatSubQuestionSection(i + 1, s.label, s.result.answer))
        .join("\n\n");
    return { plainText, blocks };
};

export const mergeCompositeWithBlocks = (
    sections: Array<{
        order: number;
        label: string;
        result: InformationAnalystResult;
    }>
): InformationAnalystResult & { blocks: AssistantMessageBlock[] } => {
    const merged = mergeCompositePayload(sections);
    const citations = sections.flatMap((s) => s.result.citations);
    const insufficientEvidence = sections.every(
        (s) => s.result.insufficientEvidence
    );
    const confidence =
        sections.length === 0
            ? 0.5
            : sections.reduce((sum, s) => sum + s.result.confidence, 0) /
              sections.length;
    return {
        answer: merged.plainText,
        citations,
        confidence,
        insufficientEvidence,
        blocks: merged.blocks,
    };
};
