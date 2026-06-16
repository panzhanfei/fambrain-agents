/**
 * KnowledgeManager 检索：向量召回 →（低置信时）关键词扫盘 → 规则精排输出。
 *
 * 不做 LLM 精排：excerpt / coverage 由确定性规则生成，避免小模型改写 excerpt、
 * 编造 notes，并与业界「检索层不用 Chat LLM、生成留给 Analyst」一致。
 *
 * L1a：Chroma 向量语义召回（优先）
 * L1b：磁盘关键词扫盘（向量空/低置信时补充）
 * L2：内存关键词打分 + pickExcerpt（唯一输出路径）
 *
 * KM-01 topics 分流：topics 仅拼入向量 query；字面 token 只用 searchQuery + subTasks。
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { logAgentIn, logAgentOut } from "@fambrain/agent-shared/agent-log";
import {
    listCorpusScanRoots,
    listMarkdownFiles,
    SCAN_FOLDERS,
    searchCorpusVectors,
    toRepoPath,
} from "@fambrain/corpus";
import {
    EXCERPT_MAX,
    LOG_BODY_PREVIEW,
    MAX_CANDIDATES,
    MAX_HITS,
    SCAN_BODY_MAX,
    VECTOR_CONFIDENT_GAP_MIN,
    VECTOR_CONFIDENT_TOP1_MAX,
} from "./km-config";
import type {
    KnowledgeHit,
    KnowledgeManagerInput,
    KnowledgeRetrievalResult,
} from "./types";

type CandidateRow = KnowledgeManagerInput["candidates"][number] & {
    score?: number;
};

type RecallSource = "provided" | "vector" | "vector+keyword_scan" | "keyword_scan";

const summarizeCandidate = (c: CandidateRow, index: number) => ({
    rank: index + 1,
    path: c.path,
    title: c.title,
    bodyChars: c.body.length,
    bodyPreview: c.body.replace(/\s+/g, " ").trim().slice(0, LOG_BODY_PREVIEW),
    score: c.score,
});

const summarizeRetrievalOut = (
    result: KnowledgeRetrievalResult,
    extra: Record<string, unknown> = {}
) => ({
    hitCount: result.hits.length,
    coverage: result.coverage,
    notes: result.notes,
    paths: result.hits.map((h) => h.path),
    hits: result.hits.map((h, i) => ({
        rank: i + 1,
        path: h.path,
        title: h.title,
        relevance: h.relevance,
        excerptPreview: h.excerpt.slice(0, LOG_BODY_PREVIEW),
    })),
    ...extra,
});

const CJK_RUN = /^[\u4e00-\u9fff]+$/;

const tokenize = (...parts: string[]): string[] => {
    const raw = parts.join(" ").toLowerCase();
    const segments = raw
        .split(/[^a-z0-9\u4e00-\u9fff]+/i)
        .filter((t) => t.length >= 2);
    const expanded: string[] = [];
    for (const t of segments) {
        expanded.push(t);
        if (CJK_RUN.test(t) && t.length > 2) {
            for (let i = 0; i < t.length - 1; i++) {
                expanded.push(t.slice(i, i + 2));
            }
        }
    }
    return [...new Set(expanded)];
};

/** 字面匹配用 token（KM-01：不含 topics，topics 只参与向量 semantic query） */
const tokenizeForRecall = (
    searchQuery: string,
    subTasks: string[] = []
): string[] => tokenize(searchQuery, ...subTasks);

const titleFromMarkdown = (fileName: string, body: string): string => {
    const line = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
    return line || fileName.replace(/\.md$/i, "");
};

const pickExcerpt = (body: string, tokens: string[]): string => {
    const text = body.replace(/\s+/g, " ").trim();
    if (!text) return "";
    const lower = text.toLowerCase();
    let idx = -1;
    for (const t of tokens) {
        const i = lower.indexOf(t);
        if (i >= 0 && (idx < 0 || i < idx)) idx = i;
    }
    if (idx < 0) return text.slice(0, EXCERPT_MAX);
    const start = Math.max(0, idx - 60);
    const slice = text.slice(start, start + EXCERPT_MAX);
    return (
        (start > 0 ? "…" : "") +
        slice +
        (start + EXCERPT_MAX < text.length ? "…" : "")
    );
};

/** L2 距离越小越好；无 score 的扫盘候选视为低置信 */
const isVectorConfident = (candidates: CandidateRow[]): boolean => {
    if (candidates.length === 0) return false;
    const scored = candidates.filter((c) => typeof c.score === "number");
    if (scored.length === 0) return false;
    const sorted = [...scored].sort(
        (a, b) => (a.score ?? Number.POSITIVE_INFINITY) - (b.score ?? Number.POSITIVE_INFINITY)
    );
    const top1 = sorted[0]!;
    if ((top1.score ?? Number.POSITIVE_INFINITY) > VECTOR_CONFIDENT_TOP1_MAX) {
        return false;
    }
    if (sorted.length === 1) return true;
    const top2 = sorted[1]!;
    return (
        (top2.score ?? 0) - (top1.score ?? 0) >= VECTOR_CONFIDENT_GAP_MIN
    );
};

const mergeCandidates = (
    primary: CandidateRow[],
    secondary: CandidateRow[]
): CandidateRow[] => {
    const byPath = new Map<string, CandidateRow>();
    for (const c of [...primary, ...secondary]) {
        const existing = byPath.get(c.path);
        if (!existing) {
            byPath.set(c.path, c);
            continue;
        }
        const existingScore = existing.score ?? Number.POSITIVE_INFINITY;
        const nextScore = c.score ?? Number.POSITIVE_INFINITY;
        if (nextScore < existingScore) {
            byPath.set(c.path, { ...c, body: c.body.length > existing.body.length ? c.body : existing.body });
        } else if (c.body.length > existing.body.length) {
            byPath.set(c.path, { ...existing, body: c.body });
        }
    }
    return [...byPath.values()].slice(0, MAX_CANDIDATES);
};

const scanDocCandidates = async (
    corpusUserId: string,
    searchQuery: string,
    subTasks: string[] = []
): Promise<CandidateRow[]> => {
    const tokens = tokenizeForRecall(searchQuery, subTasks);
    if (tokens.length === 0) return [];

    type Scored = CandidateRow & { score: number };
    const scored: Scored[] = [];
    const scanRoots = await listCorpusScanRoots(corpusUserId, listMarkdownFiles);
    for (const { root: corpusRoot } of scanRoots) {
        for (const folder of SCAN_FOLDERS) {
            const dir = path.join(corpusRoot, folder);
            for (const abs of await listMarkdownFiles(dir)) {
                const body = await readFile(abs, "utf8").catch(() => "");
                if (!body) continue;
                const repoPath = toRepoPath(abs);
                const haystack = `${repoPath} ${body}`.toLowerCase();
                let score = 0;
                for (const t of tokens) {
                    if (haystack.includes(t)) score += 1;
                }
                if (score === 0) continue;
                scored.push({
                    path: repoPath,
                    title: titleFromMarkdown(path.basename(abs), body),
                    body: body.slice(0, SCAN_BODY_MAX),
                    score,
                });
            }
        }
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, MAX_CANDIDATES).map(({ path, title, body }) => ({
        path,
        title,
        body,
    }));
};

const vectorScoreToRelevance = (score: number | undefined): number => {
    if (typeof score !== "number") return 0;
    return Math.max(0, Math.min(1, 1 - score / 2));
};

const retrieveByKeywords = (
    input: Pick<KnowledgeManagerInput, "searchQuery" | "subTasks">,
    candidates: CandidateRow[]
): KnowledgeRetrievalResult => {
    const tokens = tokenizeForRecall(input.searchQuery, input.subTasks);
    if (candidates.length === 0 || tokens.length === 0) {
        return { hits: [], coverage: "none", notes: null };
    }

    const scored = candidates
        .map((c) => {
            const haystack = `${c.path} ${c.title} ${c.body}`.toLowerCase();
            let matched = 0;
            for (const t of tokens) {
                if (haystack.includes(t)) matched += 1;
            }
            const keywordRelevance =
                tokens.length > 0 ? Math.min(1, matched / tokens.length) : 0;
            const vectorRelevance = vectorScoreToRelevance(c.score);
            const relevance = Math.max(keywordRelevance, vectorRelevance);
            return {
                path: c.path,
                title: c.title,
                excerpt: pickExcerpt(c.body, tokens),
                relevance,
                vectorScore: c.score,
            };
        })
        .filter((h) => h.relevance > 0)
        .sort((a, b) => b.relevance - a.relevance);

    const hits: KnowledgeHit[] = scored.slice(0, MAX_HITS).map(
        ({ path: p, title, excerpt, relevance }) => ({
            path: p,
            title,
            excerpt,
            relevance,
        })
    );

    const top = hits[0]?.relevance ?? 0;
    const coverage =
        top >= 0.6 ? "sufficient" : top > 0 ? "partial" : "none";

    return {
        hits,
        coverage,
        notes:
            coverage === "partial"
                ? "规则匹配部分覆盖；excerpt 来自 chunk 原文截断。"
                : null,
    };
};

/** candidates 非空时禁止最终 hits 为空（D3-2） */
const ensureNonEmptyHits = (
    input: Pick<KnowledgeManagerInput, "searchQuery" | "subTasks">,
    candidates: CandidateRow[],
    result: KnowledgeRetrievalResult
): KnowledgeRetrievalResult => {
    if (result.hits.length > 0 || candidates.length === 0) return result;

    const tokens = tokenizeForRecall(input.searchQuery, input.subTasks);
    const sorted = [...candidates].sort((a, b) => {
        const sa = a.score ?? Number.POSITIVE_INFINITY;
        const sb = b.score ?? Number.POSITIVE_INFINITY;
        return sa - sb;
    });
    const top = sorted[0]!;
    const excerpt =
        pickExcerpt(top.body, tokens) || top.body.slice(0, EXCERPT_MAX).trim();

    return {
        hits: [
            {
                path: top.path,
                title: top.title,
                excerpt,
                relevance: Math.max(0.35, vectorScoreToRelevance(top.score)),
            },
        ],
        coverage: "partial",
        notes: "候选非空但 token 未命中，按向量/扫盘 Top1 规则补选。",
    };
};

const loadCandidates = async (
    input: KnowledgeManagerInput
): Promise<{
    candidates: CandidateRow[];
    recallSource: RecallSource;
    vectorConfident: boolean;
}> => {
    if (input.candidates.length > 0) {
        return {
            candidates: input.candidates,
            recallSource: "provided",
            vectorConfident: true,
        };
    }

    const vectorQuery = [
        input.searchQuery,
        ...input.topics,
        ...input.subTasks,
    ].join(" ");

    let vectorCandidates: CandidateRow[] = [];
    try {
        const vectorHits = await searchCorpusVectors(
            input.corpusUserId,
            vectorQuery,
            MAX_CANDIDATES
        );
        vectorCandidates = vectorHits.map((h) => ({
            path: h.path,
            title: h.title,
            body: h.body,
            score: h.score,
        }));
    } catch {
        vectorCandidates = [];
    }

    if (vectorCandidates.length === 0) {
        const scanned = await scanDocCandidates(
            input.corpusUserId,
            input.searchQuery,
            input.subTasks
        );
        return {
            candidates: scanned,
            recallSource: "keyword_scan",
            vectorConfident: false,
        };
    }

    if (isVectorConfident(vectorCandidates)) {
        return {
            candidates: vectorCandidates,
            recallSource: "vector",
            vectorConfident: true,
        };
    }

    const scanned = await scanDocCandidates(
        input.corpusUserId,
        input.searchQuery,
        input.subTasks
    );
    return {
        candidates: mergeCandidates(vectorCandidates, scanned),
        recallSource: "vector+keyword_scan",
        vectorConfident: false,
    };
};

export const retrieveKnowledge = async (
    input: KnowledgeManagerInput
): Promise<KnowledgeRetrievalResult> => {
    logAgentIn("KnowledgeManager", "进入", {
        corpusUserId: input.corpusUserId,
        searchQuery: input.searchQuery,
        topics: input.topics,
        subTasks: input.subTasks,
        candidatesProvided: input.candidates.length,
    });

    const { candidates, recallSource, vectorConfident } =
        await loadCandidates(input);

    if (candidates.length === 0) {
        const empty = { hits: [], coverage: "none" as const, notes: null };
        logAgentOut("KnowledgeManager", "出去", summarizeRetrievalOut(empty, {
            recallSource,
            resultSource: "empty",
            vectorConfident,
        }));
        return empty;
    }

    const ruleResult = ensureNonEmptyHits(
        input,
        candidates,
        retrieveByKeywords(input, candidates)
    );

    logAgentOut("KnowledgeManager", "出去", summarizeRetrievalOut(ruleResult, {
        recallSource,
        resultSource: "rule",
        vectorConfident,
        candidateCount: candidates.length,
        candidatesPreview: summarizeCandidate(candidates[0]!, 0),
    }));
    return ruleResult;
};
