/**
 * 列举型展示：序号 + 项目名；分页说明文案。
 */
import type { KnowledgeHit } from "@/agentflow/agents/online/knowledge-manager";
import { ENUMERATION_EXHAUSTIVE_PAGE_SIZE } from "@/agentflow/agents/online/corpus-lister/list";
import {
    ENUMERATION_ACTION_PROMPTS,
    type EnumerationListKind,
} from "@/agentflow/agents/online/intake-coordinator/enumeration";

export const hitDisplayTitle = (hit: KnowledgeHit): string => {
    const title = hit.title?.trim();
    if (title) return title;
    const base = hit.path.split("/").pop() ?? hit.path;
    return base.replace(/\.md$/i, "");
};

/** 从 experience excerpt 解析职位（结构字段，非口语词表） */
export const hitDisplayRole = (hit: KnowledgeHit): string | null => {
    const fromExcerpt = hit.excerpt.match(
        /(?:\*\*)?角色(?:\*\*)?\s*[：:]\s*([^*\n]+)/
    );
    if (fromExcerpt?.[1]?.trim()) {
        return fromExcerpt[1].trim().replace(/\*\*/g, "");
    }
    const job = hit.excerpt.match(/(?:职位|岗位)\s*[：:]\s*([^\n·|]+)/);
    return job?.[1]?.trim().replace(/\*\*/g, "") || null;
};

const shouldSkipEnumerationLine = (line: string): boolean => {
    const t = line.replace(/\|/g, " ").replace(/\s+/g, " ").trim();
    if (t.length < 6) return true;
    if (/^[-#|*\s]+$/.test(t)) return true;
    if (/^#{1,6}\s/.test(t)) return true;
    if (/^>\s/.test(t)) return true;
    if (/^(-|\*|\d+\.)\s+\*\*/.test(t)) return true;
    if (
        /^(路径|版权|离线副本|归类索引|任职|项目主线|严禁公开|doc\/projects)/.test(
            t
        )
    ) {
        return true;
    }
    return false;
};

/** 非列举场景仍可用：跳过 md 噪音行 */
export const compactEnumerationExcerpt = (
    excerpt: string,
    max = 100
): string => {
    for (const line of excerpt.split("\n")) {
        const t = line.replace(/\|/g, " ").replace(/\s+/g, " ").trim();
        if (shouldSkipEnumerationLine(t)) continue;
        const stripped = t
            .replace(/^[-*]\s+/, "")
            .replace(/\*\*/g, "")
            .trim();
        if (stripped.length < 6) continue;
        return stripped.length <= max
            ? stripped
            : `${stripped.slice(0, max - 1)}…`;
    }
    const flat = excerpt
        .replace(/\s+/g, " ")
        .replace(/\*\*/g, "")
        .trim();
    if (!flat) return "—";
    return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
};

/** @deprecated 使用 compactEnumerationExcerpt */
export const compactExcerptLine = compactEnumerationExcerpt;

export const enumerationStartIndex = (input: {
    page?: number;
    pageSize?: number;
}): number => {
    const page = Math.max(1, input.page ?? 1);
    const pageSize = Math.max(1, input.pageSize ?? 1);
    return (page - 1) * pageSize + 1;
};

/** 列举纯文本：序号 + 标题；employer 附职位 */
export const formatHitsAsAnswerList = (
    hits: KnowledgeHit[],
    _language: "zh" | "en" | "mixed",
    startIndex = 1,
    listKind: "project" | "employer" = "project"
): string =>
    hits
        .map((h, i) => {
            const title = hitDisplayTitle(h);
            if (listKind === "employer") {
                const role = hitDisplayRole(h);
                return role
                    ? `${startIndex + i}. **${title}** — ${role}`
                    : `${startIndex + i}. **${title}**`;
            }
            return `${startIndex + i}. **${title}**`;
        })
        .join("\n");

export type EnumerationPaginationHintInput = {
    language: "zh" | "en" | "mixed";
    listKind: "project" | "employer";
    total: number;
    shown: number;
    page: number;
    pageSize: number;
    startIndex: number;
    hasMore: boolean;
    listIntent?: "preview" | "continue" | "exhaustive" | null;
};

/** 列举分页说明（纯文本 footer + Web UI 共用） */
export const formatEnumerationPaginationHint = (
    input: EnumerationPaginationHintInput
): string => {
    if (input.total <= input.shown && !input.hasMore) return "";

    const endIndex = input.startIndex + input.shown - 1;
    const totalPages = Math.max(1, Math.ceil(input.total / input.pageSize));
    const fullListPages = Math.max(
        1,
        Math.ceil(input.total / ENUMERATION_EXHAUSTIVE_PAGE_SIZE)
    );
    const paginatedMode =
        input.listIntent === "exhaustive" || input.listIntent === "continue";

    if (input.language === "en") {
        const entity = input.listKind === "project" ? "projects" : "entries";
        if (!paginatedMode && input.hasMore) {
            return `\n\n(${input.total} ${entity} in corpus · preview ${input.shown} (#${input.startIndex}–${endIndex}) · say "list all projects" for paginated view, ${ENUMERATION_EXHAUSTIVE_PAGE_SIZE}/page, ${fullListPages} pages total)`;
        }
        if (paginatedMode && input.hasMore) {
            return `\n\n(${input.total} ${entity} · page ${input.page}/${totalPages} · #${input.startIndex}–${endIndex} · say "more projects" for next page)`;
        }
        if (paginatedMode) {
            return `\n\n(${input.total} ${entity} · page ${input.page}/${totalPages} · #${input.startIndex}–${endIndex} · complete)`;
        }
        return `\n\n(${input.total} ${entity} in corpus · showing ${input.shown})`;
    }

    const kind: EnumerationListKind =
        input.listKind === "project" ? "project" : "experience";
    const entity = kind === "project" ? "项目" : "任职/公司";
    const exhaustivePrompt = ENUMERATION_ACTION_PROMPTS[kind].exhaustive;
    const continuePrompt = ENUMERATION_ACTION_PROMPTS[kind].continue;
    if (!paginatedMode && input.hasMore) {
        return `\n\n（语料共 ${input.total} 个${entity} · 本节预览 ${input.shown} 个，序号 ${input.startIndex}–${endIndex} · 发送「${exhaustivePrompt}」可分页浏览完整列表，每页 ${ENUMERATION_EXHAUSTIVE_PAGE_SIZE} 条，共 ${fullListPages} 页）`;
    }
    if (paginatedMode && input.hasMore) {
        return `\n\n（语料共 ${input.total} 个${entity} · 第 ${input.page}/${totalPages} 页 · 序号 ${input.startIndex}–${endIndex} · 发送「${continuePrompt}」查看下一页）`;
    }
    if (paginatedMode) {
        return `\n\n（语料共 ${input.total} 个${entity} · 第 ${input.page}/${totalPages} 页 · 序号 ${input.startIndex}–${endIndex} · 已全部列出）`;
    }
    return `\n\n（语料共 ${input.total} 个${entity} · 已显示 ${input.shown} 个）`;
};

/** Web UI 单行分页说明（无括号包裹） */
export const formatEnumerationPaginationLine = (
    input: EnumerationPaginationHintInput
): string => {
    const raw = formatEnumerationPaginationHint(input).trim();
    return raw.replace(/^（/, "").replace(/）$/, "").replace(/^\(/, "").replace(/\)$/, "");
};
