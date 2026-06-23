/**
 * KnowledgeManager 检索：Hybrid 并行召回（向量 ∥ BM25）→ RRF 融合 → 规则精排输出。
 *
 * 不做 LLM 精排：excerpt / coverage 由确定性规则生成，避免小模型改写 excerpt、
 * 编造 notes，并与业界「检索层不用 Chat LLM、生成留给 Analyst」一致。
 *
 * L1a：Chroma 向量语义召回（与 sparse 并行）
 * L1b：corpus BM25 sparse 召回（与向量并行）
 * L1c：RRF 融合候选（HY-02～03）
 * L2：内存关键词打分 + pickExcerpt（唯一输出路径）
 *
 * KM-01 topics 分流：topics 仅拼入向量 query；sparse 用 searchQuery + subTasks。
 * KM-05 rank：relevance = token + vector/sparse + pathBoost（封顶 1.0）。
 * KM-06 兜底：ensureNonEmptyHits 与 rank 共用 rankCandidates。
 * KM-08/09：queryProfile 分档 vectorTopK / maxHits；Intake queryType 优先。
 * KM-10：表格 excerpt；KM-11：identityGuard。
 * KM-13～15：列举 experience 专扫 + fill + coverage；KM-16：同 path merge body。
 * EV-01～04：confidenceTier 分档 + coverage 由 tier 推导 + 低置信弱 coalesce。
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { logAgentIn, logAgentOut } from "@fambrain/agent-shared/agent-log";
import { aggregateFeedbackByPath } from "@fambrain/db";
import {
    listCorpusScanRoots,
    listMarkdownFiles,
    toRepoPath,
} from "@fambrain/corpus";
import { hybridRecall } from "./hybrid-recall";
import {
    getProfileRecallParams,
    LOG_BODY_PREVIEW,
    MAX_CANDIDATES,
    SCAN_BODY_MAX,
} from "./km-config";
import { resolveQueryProfile } from "./query-profile";
import { resolveEnumerationTarget } from "@/agentflow/agents/online/intake-coordinator/enumeration-target";
import type { EnumerationTarget } from "@/agentflow/agents/online/intake-coordinator/enumeration-target";
import {
    applyEnumerationFill,
    applyIdentityGuard,
    buildEnumerationCoverage,
    findPersonalResumeCandidate,
    isExperienceEntryPath,
    isProjectEntryPath,
    isPersonalResumePath,
    mergeCandidatesByPath,
    mergeChunkBodies,
    pickExcerpt,
    rankCandidates,
} from "./retrieve-helpers";
import {
    assessConfidence,
    deriveCoverageFromTier,
    shouldCoalesceEmptyHits,
    tierNotes,
} from "./score-candidate";
import type {
    ConfidenceTier,
    KnowledgeCandidate,
    KnowledgeHit,
    KnowledgeManagerInput,
    KnowledgeRetrievalResult,
    QueryProfile,
    RecallSource,
} from "./types";

type CandidateRow = KnowledgeCandidate;

const summarizeCandidate = (c: CandidateRow, index: number) => ({
    rank: index + 1,
    path: c.path,
    title: c.title,
    bodyChars: c.body.length,
    bodyPreview: c.body.replace(/\s+/g, " ").trim().slice(0, LOG_BODY_PREVIEW),
    score: c.score,
    rawScore: c.rawScore,
    recallChannel: c.recallChannel,
    fusionScore: c.fusionScore,
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

/** 合并两路候选（identity / enumeration 补注入用） */
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

/** KM-11：identity 问法时若召回未命中 personal 简历，从 personal/ 目录补注入 */
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

/** KM-13b：列举项目时加载 projects/ 下全部项目 md。 */
const loadProjectEntryCandidates = async (
    corpusUserId: string
): Promise<CandidateRow[]> => {
    const scanRoots = await listCorpusScanRoots(corpusUserId, listMarkdownFiles);
    const entries: CandidateRow[] = [];
    for (const { root: corpusRoot } of scanRoots) {
        const dir = path.join(corpusRoot, "projects");
        for (const abs of await listMarkdownFiles(dir)) {
            const repoPath = toRepoPath(abs);
            if (!isProjectEntryPath(repoPath)) continue;
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

const ensureEnumerationProjectCandidates = async (
    corpusUserId: string,
    queryProfile: QueryProfile,
    candidates: CandidateRow[]
): Promise<{ candidates: CandidateRow[]; expectedPaths: string[] }> => {
    if (queryProfile !== "enumeration") {
        return { candidates, expectedPaths: [] };
    }
    const loaded = await loadProjectEntryCandidates(corpusUserId);
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

const resolveKmEnumerationTarget = (
    input: KnowledgeManagerInput
): EnumerationTarget | null => {
    if (
        resolveQueryProfile(
            input.searchQuery,
            input.subTasks,
            input.queryType
        ) !== "enumeration"
    ) {
        return null;
    }
    return resolveEnumerationTarget({
        label: input.subTasks[0] ?? "",
        searchQuery: input.searchQuery,
        topics: input.topics,
        subTasks: input.subTasks,
    });
};

const retrieveByKeywords = (
    input: Pick<KnowledgeManagerInput, "searchQuery" | "subTasks">,
    candidates: CandidateRow[],
    maxHits: number,
    queryProfile: QueryProfile,
    feedbackByPath?: Map<string, number>
): Omit<KnowledgeRetrievalResult, "coverage" | "confidenceTier" | "confidenceScore"> & {
    hits: KnowledgeHit[];
} => {
    const tokens = tokenizeForRecall(input.searchQuery, input.subTasks);
    if (candidates.length === 0) {
        return { hits: [], notes: null };
    }

    const ranked = rankCandidates(
        candidates,
        tokens,
        pickExcerpt,
        queryProfile,
        feedbackByPath
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

    return { hits, notes: null };
};

/** EV-03：低置信不硬塞 Top1；high/mid 仍 coalesce（D3-2）。 */
const ensureNonEmptyHits = (
    input: Pick<KnowledgeManagerInput, "searchQuery" | "subTasks">,
    candidates: CandidateRow[],
    result: KnowledgeRetrievalResult,
    queryProfile: QueryProfile,
    tier: ConfidenceTier,
    topRelevance: number,
    feedbackByPath?: Map<string, number>
): KnowledgeRetrievalResult => {
    if (result.hits.length > 0 || candidates.length === 0) return result;
    if (!shouldCoalesceEmptyHits(tier, topRelevance)) {
        return {
            ...result,
            coverage: "none",
            notes: tierNotes(
                tier,
                "候选非空但置信过低，未强制补选 Top1。"
            ),
        };
    }

    const tokens = tokenizeForRecall(input.searchQuery, input.subTasks);
    const ranked = rankCandidates(
        candidates,
        tokens,
        pickExcerpt,
        queryProfile,
        feedbackByPath
    );
    const top = ranked[0];
    if (!top) return result;

    return {
        ...result,
        hits: [
            {
                path: top.path,
                title: top.title,
                excerpt: top.excerpt,
                relevance: Math.max(0.35, top.relevance),
            },
        ],
        coverage: "partial",
        notes: tierNotes(
            tier,
            "候选非空但 token 未命中，按 token+vector+pathBoost 加权补选。"
        ),
    };
};

const finalizeHits = (
    input: KnowledgeManagerInput,
    candidates: CandidateRow[],
    queryProfile: QueryProfile,
    maxHits: number,
    recallMeta: {
        recallSource: RecallSource;
        topCandidate?: KnowledgeCandidate;
    },
    expectedEnumerationPaths: string[] = [],
    enumerationTarget: EnumerationTarget | null = null,
    feedbackByPath?: Map<string, number>
): {
    result: KnowledgeRetrievalResult;
    ranked: ReturnType<typeof rankCandidates>;
    guardApplied: boolean;
    fillApplied: boolean;
    confidenceTier: ConfidenceTier;
    confidenceScore: number;
} => {
    const tokens = tokenizeForRecall(input.searchQuery, input.subTasks);
    const ranked = rankCandidates(
        candidates,
        tokens,
        pickExcerpt,
        queryProfile,
        feedbackByPath
    );

    let result: KnowledgeRetrievalResult = {
        ...retrieveByKeywords(
            input,
            candidates,
            maxHits,
            queryProfile,
            feedbackByPath
        ),
        coverage: "none",
    };

    const provisional = assessConfidence({
        queryProfile,
        hits: result.hits,
        ranked,
        recallSource: recallMeta.recallSource,
        topCandidate: recallMeta.topCandidate ?? candidates[0],
        guardApplied: false,
        fillApplied: false,
        candidateCount: candidates.length,
        expectedExperienceCount: expectedEnumerationPaths.length,
    });

    result = ensureNonEmptyHits(
        input,
        candidates,
        result,
        queryProfile,
        provisional.tier,
        provisional.top1Relevance,
        feedbackByPath
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

    const fillTarget = enumerationTarget ?? "experience";
    const filled = applyEnumerationFill(
        result.hits,
        candidates,
        ranked,
        queryProfile,
        maxHits,
        expectedEnumerationPaths,
        tokens,
        fillTarget
    );
    result = { ...result, hits: filled.hits };

    if (queryProfile === "enumeration" && expectedEnumerationPaths.length > 0) {
        const entityLabel = fillTarget === "project" ? "项目" : "经历";
        const { coverage, notes } = buildEnumerationCoverage(
            result.hits,
            expectedEnumerationPaths.length,
            filled.filledCount,
            entityLabel
        );
        const assessment = assessConfidence({
            queryProfile,
            hits: result.hits,
            ranked,
            recallSource: recallMeta.recallSource,
            topCandidate: recallMeta.topCandidate ?? candidates[0],
            guardApplied: guarded.guardApplied,
            fillApplied: filled.fillApplied,
            candidateCount: candidates.length,
            expectedExperienceCount: expectedEnumerationPaths.length,
        });
        result = {
            ...result,
            coverage,
            notes: tierNotes(assessment.tier, notes),
            confidenceTier: assessment.tier,
            confidenceScore: assessment.score,
        };
    } else {
        const assessment = assessConfidence({
            queryProfile,
            hits: result.hits,
            ranked,
            recallSource: recallMeta.recallSource,
            topCandidate: recallMeta.topCandidate ?? candidates[0],
            guardApplied: guarded.guardApplied,
            fillApplied: filled.fillApplied,
            candidateCount: candidates.length,
            expectedExperienceCount: expectedEnumerationPaths.length,
        });
        result = {
            ...result,
            coverage: deriveCoverageFromTier(
                assessment.tier,
                result.hits,
                assessment.top1Relevance
            ),
            notes: tierNotes(assessment.tier, result.notes),
            confidenceTier: assessment.tier,
            confidenceScore: assessment.score,
        };
    }

    return {
        result,
        ranked,
        guardApplied: guarded.guardApplied,
        fillApplied: filled.fillApplied,
        confidenceTier: result.confidenceTier ?? "low",
        confidenceScore: result.confidenceScore ?? 0,
    };
};

const loadCandidates = async (
    input: KnowledgeManagerInput,
    vectorTopK: number
): Promise<{
    candidates: CandidateRow[];
    recallSource: RecallSource;
    vectorRawCount: number;
    sparseRawCount: number;
    uniquePathCount: number;
    fusionTopPath: string | null;
}> => {
    if (input.candidates.length > 0) {
        const uniquePathCount = new Set(input.candidates.map((c) => c.path)).size;
        return {
            candidates: input.candidates,
            recallSource: "provided",
            vectorRawCount: input.candidates.length,
            sparseRawCount: 0,
            uniquePathCount,
            fusionTopPath: input.candidates[0]?.path ?? null,
        };
    }

    const vectorQuery = [
        input.searchQuery,
        ...input.topics,
        ...input.subTasks,
    ].join(" ");
    const sparseQuery = [input.searchQuery, ...input.subTasks].join(" ");

    const hybrid = await hybridRecall(
        input.corpusUserId,
        vectorQuery,
        sparseQuery,
        vectorTopK
    );

    return {
        candidates: hybrid.candidates,
        recallSource: hybrid.recallSource,
        vectorRawCount: hybrid.vectorRawCount,
        sparseRawCount: hybrid.sparseRawCount,
        uniquePathCount: hybrid.uniquePathCount,
        fusionTopPath: hybrid.candidates[0]?.path ?? null,
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

    const {
        candidates: rawCandidates,
        recallSource,
        vectorRawCount,
        sparseRawCount,
        uniquePathCount,
        fusionTopPath,
    } = await loadCandidates(input, vectorTopK);
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
    const enumerationTarget = resolveKmEnumerationTarget(input);
    let expectedEnumerationPaths: string[] = [];
    if (queryProfile === "enumeration" && enumerationTarget === "project") {
        const loaded = await ensureEnumerationProjectCandidates(
            input.corpusUserId,
            queryProfile,
            candidates
        );
        candidates = loaded.candidates;
        expectedEnumerationPaths = loaded.expectedPaths;
    } else {
        const loaded = await ensureEnumerationExperienceCandidates(
            input.corpusUserId,
            queryProfile,
            candidates
        );
        candidates = loaded.candidates;
        expectedEnumerationPaths = loaded.expectedPaths;
    }

    if (candidates.length === 0) {
        const empty: KnowledgeRetrievalResult = {
            hits: [],
            coverage: "none",
            notes: null,
            confidenceTier: "low",
            confidenceScore: 0,
        };
        logAgentOut("KnowledgeManager", "出去", summarizeRetrievalOut(empty, {
            recallSource,
            resultSource: "empty",
            vectorRawCount,
            sparseRawCount,
            uniquePathCount,
            fusionTopPath,
            queryProfile,
            vectorTopK,
            maxHits,
            confidenceTier: "low",
            confidenceScore: 0,
        }));
        return empty;
    }

    const feedbackByPath = await aggregateFeedbackByPath(input.corpusUserId).catch(
        () => new Map<string, number>()
    );

    const {
        result: ruleResult,
        ranked: topRankedList,
        guardApplied,
        fillApplied,
        confidenceTier,
        confidenceScore,
    } = finalizeHits(
        input,
        candidates,
        queryProfile,
        maxHits,
        {
            recallSource,
            topCandidate: rawCandidates[0],
        },
        expectedEnumerationPaths,
        enumerationTarget,
        feedbackByPath
    );

    const topRanked = topRankedList[0];

    logAgentOut("KnowledgeManager", "出去", summarizeRetrievalOut(ruleResult, {
        recallSource,
        resultSource: "rule",
        vectorRawCount,
        sparseRawCount,
        uniquePathCount,
        fusionTopPath,
        queryProfile,
        vectorTopK,
        maxHits,
        guardApplied,
        fillApplied,
        confidenceTier,
        confidenceScore,
        fusionScore: rawCandidates[0]?.fusionScore ?? null,
        recallChannel: rawCandidates[0]?.recallChannel ?? null,
        expectedExperienceCount: expectedEnumerationPaths.length,
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
