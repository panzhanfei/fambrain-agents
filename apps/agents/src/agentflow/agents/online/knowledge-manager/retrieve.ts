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
 * KM-05 rank：relevance = token + vector + pathBoost（封顶 1.0）。
 * KM-06 兜底：ensureNonEmptyHits 与 rank 共用 rankCandidates。
 * KM-08/09：queryProfile 分档 vectorTopK / maxHits；Intake queryType 优先。
 * KM-10：表格 excerpt；KM-11：identityGuard。
 * KM-13～15：列举 experience 专扫 + fill + coverage；KM-16：同 path merge body。
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
    getProfileRecallParams,
    LOG_BODY_PREVIEW,
    MAX_CANDIDATES,
    SCAN_BODY_MAX,
    VECTOR_CONFIDENT_GAP_MIN,
    VECTOR_CONFIDENT_TOP1_MAX,
} from "./km-config";
import { resolveQueryProfile } from "./query-profile";
import {
    applyEnumerationFill,
    applyIdentityGuard,
    buildEnumerationCoverage,
    dedupeVectorByPath,
    findPersonalResumeCandidate,
    isExperienceEntryPath,
    isPersonalResumePath,
    mergeCandidatesByPath,
    mergeChunkBodies,
    pickExcerpt,
    rankCandidates,
} from "./retrieve-helpers";
import type {
    KnowledgeHit,
    KnowledgeManagerInput,
    KnowledgeRetrievalResult,
    QueryProfile,
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
    secondary: CandidateRow[],
    maxCandidates: number
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
        const mergedBody = mergeChunkBodies([existing.body, c.body]);
        if (nextScore < existingScore) {
            byPath.set(c.path, { ...c, body: mergedBody });
        } else {
            byPath.set(c.path, { ...existing, body: mergedBody });
        }
    }
    return [...byPath.values()].slice(0, maxCandidates);
};

const scanDocCandidates = async (
    corpusUserId: string,
    searchQuery: string,
    subTasks: string[] = [],
    maxCandidates: number = MAX_CANDIDATES
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
    return scored.slice(0, maxCandidates).map(({ path, title, body }) => ({
        path,
        title,
        body,
    }));
};

/** KM-11：identity 问法时若扫盘未命中 personal 简历，从 personal/ 目录补注入 */
const loadPersonalResumeCandidate = async (
    corpusUserId: string
): Promise<CandidateRow | null> => {
    const scanRoots = await listCorpusScanRoots(corpusUserId, listMarkdownFiles);
    const personalFiles: CandidateRow[] = [];
    for (const { root: corpusRoot } of scanRoots) {
        const dir = path.join(corpusRoot, "personal");
        for (const abs of await listMarkdownFiles(dir)) {
            const repoPath = toRepoPath(abs);
            if (!isPersonalResumePath(repoPath)) continue;
            const body = await readFile(abs, "utf8").catch(() => "");
            if (!body) continue;
            personalFiles.push({
                path: repoPath,
                title: titleFromMarkdown(path.basename(abs), body),
                body: body.slice(0, SCAN_BODY_MAX),
            });
        }
    }
    return findPersonalResumeCandidate(personalFiles);
};

/** KM-13：列举问法时加载 experience/ 下全部任职 md。 */
const loadExperienceEntryCandidates = async (
    corpusUserId: string
): Promise<CandidateRow[]> => {
    const scanRoots = await listCorpusScanRoots(corpusUserId, listMarkdownFiles);
    const entries: CandidateRow[] = [];
    for (const { root: corpusRoot } of scanRoots) {
        const dir = path.join(corpusRoot, "experience");
        for (const abs of await listMarkdownFiles(dir)) {
            const repoPath = toRepoPath(abs);
            if (!isExperienceEntryPath(repoPath)) continue;
            const body = await readFile(abs, "utf8").catch(() => "");
            if (!body) continue;
            entries.push({
                path: repoPath,
                title: titleFromMarkdown(path.basename(abs), body),
                body: body.slice(0, SCAN_BODY_MAX),
            });
        }
    }
    return entries.sort((a, b) => a.path.localeCompare(b.path));
};

const ensureIdentityPersonalCandidate = async (
    corpusUserId: string,
    queryProfile: QueryProfile,
    candidates: CandidateRow[]
): Promise<CandidateRow[]> => {
    if (queryProfile !== "identity") return candidates;
    if (findPersonalResumeCandidate(candidates)) return candidates;
    const loaded = await loadPersonalResumeCandidate(corpusUserId);
    if (!loaded) return candidates;
    return mergeCandidates([loaded], candidates, Math.max(candidates.length + 1, MAX_CANDIDATES));
};

const ensureEnumerationExperienceCandidates = async (
    corpusUserId: string,
    queryProfile: QueryProfile,
    candidates: CandidateRow[]
): Promise<{ candidates: CandidateRow[]; expectedPaths: string[] }> => {
    if (queryProfile !== "enumeration") {
        return { candidates, expectedPaths: [] };
    }
    const loaded = await loadExperienceEntryCandidates(corpusUserId);
    const expectedPaths = loaded.map((c) => c.path);
    if (loaded.length === 0) return { candidates, expectedPaths: [] };
    const merged = mergeCandidates(
        loaded,
        candidates,
        Math.max(candidates.length + loaded.length, MAX_CANDIDATES * 2)
    );
    return {
        candidates: mergeCandidatesByPath(
            merged,
            MAX_CANDIDATES * 2,
            MAX_CANDIDATES * 2
        ),
        expectedPaths,
    };
};

const retrieveByKeywords = (
    input: Pick<KnowledgeManagerInput, "searchQuery" | "subTasks">,
    candidates: CandidateRow[],
    maxHits: number,
    queryProfile: QueryProfile
): KnowledgeRetrievalResult => {
    const tokens = tokenizeForRecall(input.searchQuery, input.subTasks);
    if (candidates.length === 0) {
        return { hits: [], coverage: "none", notes: null };
    }

    const ranked = rankCandidates(
        candidates,
        tokens,
        pickExcerpt,
        queryProfile
    );
    const scored = ranked.filter((h) => h.relevance > 0);

    const hits: KnowledgeHit[] = scored.slice(0, maxHits).map(
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

/** candidates 非空时禁止最终 hits 为空（D3-2）；KM-06 与 rank 共用 rankCandidates */
const ensureNonEmptyHits = (
    input: Pick<KnowledgeManagerInput, "searchQuery" | "subTasks">,
    candidates: CandidateRow[],
    result: KnowledgeRetrievalResult,
    queryProfile: QueryProfile
): KnowledgeRetrievalResult => {
    if (result.hits.length > 0 || candidates.length === 0) return result;

    const tokens = tokenizeForRecall(input.searchQuery, input.subTasks);
    const ranked = rankCandidates(
        candidates,
        tokens,
        pickExcerpt,
        queryProfile
    );
    const top = ranked[0];
    if (!top) return result;

    return {
        hits: [
            {
                path: top.path,
                title: top.title,
                excerpt: top.excerpt,
                relevance: Math.max(0.35, top.relevance),
            },
        ],
        coverage: "partial",
        notes: "候选非空但 token 未命中，按 token+vector+pathBoost 加权补选。",
    };
};

const finalizeHits = (
    input: KnowledgeManagerInput,
    candidates: CandidateRow[],
    queryProfile: QueryProfile,
    maxHits: number,
    expectedExperiencePaths: string[] = []
): {
    result: KnowledgeRetrievalResult;
    ranked: ReturnType<typeof rankCandidates>;
    guardApplied: boolean;
    fillApplied: boolean;
} => {
    const tokens = tokenizeForRecall(input.searchQuery, input.subTasks);
    const ranked = rankCandidates(
        candidates,
        tokens,
        pickExcerpt,
        queryProfile
    );

    let result = ensureNonEmptyHits(
        input,
        candidates,
        retrieveByKeywords(input, candidates, maxHits, queryProfile),
        queryProfile
    );

    const guarded = applyIdentityGuard(
        result.hits,
        candidates,
        ranked,
        queryProfile,
        maxHits,
        tokens
    );
    result = { ...result, hits: guarded.hits };

    if (guarded.guardApplied && result.hits[0]) {
        const top = ranked.find((r) => r.path === result.hits[0]!.path);
        if (top) {
            result.hits[0] = {
                ...result.hits[0]!,
                excerpt: pickExcerpt(
                    candidates.find((c) => c.path === top.path)?.body ??
                        top.body,
                    tokens,
                    queryProfile
                ),
            };
        }
    }

    const filled = applyEnumerationFill(
        result.hits,
        candidates,
        ranked,
        queryProfile,
        maxHits,
        expectedExperiencePaths,
        tokens
    );
    result = { ...result, hits: filled.hits };

    if (queryProfile === "enumeration" && expectedExperiencePaths.length > 0) {
        const { coverage, notes } = buildEnumerationCoverage(
            result.hits,
            expectedExperiencePaths.length,
            filled.filledCount
        );
        result = { ...result, coverage, notes };
    }

    return {
        result,
        ranked,
        guardApplied: guarded.guardApplied,
        fillApplied: filled.fillApplied,
    };
};

const loadCandidates = async (
    input: KnowledgeManagerInput,
    vectorTopK: number
): Promise<{
    candidates: CandidateRow[];
    recallSource: RecallSource;
    vectorConfident: boolean;
    vectorRawCount: number;
    uniquePathCount: number;
}> => {
    if (input.candidates.length > 0) {
        const uniquePathCount = new Set(input.candidates.map((c) => c.path)).size;
        return {
            candidates: input.candidates,
            recallSource: "provided",
            vectorConfident: true,
            vectorRawCount: input.candidates.length,
            uniquePathCount,
        };
    }

    const vectorQuery = [
        input.searchQuery,
        ...input.topics,
        ...input.subTasks,
    ].join(" ");

    let vectorCandidates: CandidateRow[] = [];
    let vectorRawCount = 0;
    try {
        const vectorHits = await searchCorpusVectors(
            input.corpusUserId,
            vectorQuery,
            vectorTopK
        );
        vectorRawCount = vectorHits.length;
        vectorCandidates = dedupeVectorByPath(
            vectorHits.map((h) => ({
                path: h.path,
                title: h.title,
                body: h.body,
                score: h.score,
            })),
            undefined,
            vectorTopK
        );
    } catch {
        vectorCandidates = [];
    }

    const uniquePathCount = new Set(vectorCandidates.map((c) => c.path)).size;

    if (vectorCandidates.length === 0) {
        const scanned = await scanDocCandidates(
            input.corpusUserId,
            input.searchQuery,
            input.subTasks,
            vectorTopK
        );
        return {
            candidates: scanned,
            recallSource: "keyword_scan",
            vectorConfident: false,
            vectorRawCount: 0,
            uniquePathCount: new Set(scanned.map((c) => c.path)).size,
        };
    }

    if (isVectorConfident(vectorCandidates)) {
        return {
            candidates: vectorCandidates,
            recallSource: "vector",
            vectorConfident: true,
            vectorRawCount,
            uniquePathCount,
        };
    }

    const scanned = await scanDocCandidates(
        input.corpusUserId,
        input.searchQuery,
        input.subTasks,
        vectorTopK
    );
    const merged = mergeCandidates(vectorCandidates, scanned, vectorTopK);
    return {
        candidates: merged,
        recallSource: "vector+keyword_scan",
        vectorConfident: false,
        vectorRawCount,
        uniquePathCount: new Set(merged.map((c) => c.path)).size,
    };
};

export const retrieveKnowledge = async (
    input: KnowledgeManagerInput
): Promise<KnowledgeRetrievalResult> => {
    const queryProfile: QueryProfile = resolveQueryProfile(
        input.searchQuery,
        input.subTasks,
        input.queryType
    );
    const { vectorTopK, maxHits } = getProfileRecallParams(queryProfile);

    logAgentIn("KnowledgeManager", "进入", {
        corpusUserId: input.corpusUserId,
        searchQuery: input.searchQuery,
        topics: input.topics,
        subTasks: input.subTasks,
        queryType: input.queryType ?? null,
        queryProfile,
        vectorTopK,
        maxHits,
        candidatesProvided: input.candidates.length,
    });

    const { candidates: rawCandidates, recallSource, vectorConfident, vectorRawCount, uniquePathCount } =
        await loadCandidates(input, vectorTopK);
    let candidates = mergeCandidatesByPath(
        rawCandidates,
        MAX_CANDIDATES,
        MAX_CANDIDATES
    );
    candidates = await ensureIdentityPersonalCandidate(
        input.corpusUserId,
        queryProfile,
        candidates
    );
    const { candidates: enumCandidates, expectedPaths: expectedExperiencePaths } =
        await ensureEnumerationExperienceCandidates(
            input.corpusUserId,
            queryProfile,
            candidates
        );
    candidates = enumCandidates;

    if (candidates.length === 0) {
        const empty = { hits: [], coverage: "none" as const, notes: null };
        logAgentOut("KnowledgeManager", "出去", summarizeRetrievalOut(empty, {
            recallSource,
            resultSource: "empty",
            vectorConfident,
            vectorRawCount,
            uniquePathCount,
            queryProfile,
            vectorTopK,
            maxHits,
        }));
        return empty;
    }

    const { result: ruleResult, ranked: topRankedList, guardApplied, fillApplied } =
        finalizeHits(input, candidates, queryProfile, maxHits, expectedExperiencePaths);

    const topRanked = topRankedList[0];

    logAgentOut("KnowledgeManager", "出去", summarizeRetrievalOut(ruleResult, {
        recallSource,
        resultSource: "rule",
        vectorConfident,
        vectorRawCount,
        uniquePathCount,
        queryProfile,
        vectorTopK,
        maxHits,
        guardApplied,
        fillApplied,
        expectedExperienceCount: expectedExperiencePaths.length,
        candidateCount: candidates.length,
        candidatesPreview: summarizeCandidate(candidates[0]!, 0),
        topRank: topRanked
            ? {
                  path: topRanked.path,
                  relevance: topRanked.relevance,
                  keywordRelevance: topRanked.keywordRelevance,
                  vectorRelevance: topRanked.vectorRelevance,
                  pathBoost: topRanked.pathBoost,
              }
            : null,
    }));
    return ruleResult;
};
