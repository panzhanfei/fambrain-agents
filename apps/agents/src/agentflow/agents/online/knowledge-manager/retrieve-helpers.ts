import {
    EXCERPT_MAX,
    MAX_CANDIDATES,
    MAX_CHUNKS_PER_PATH,
    MERGED_CHUNK_BODY_MAX,
    PATH_BOOST_EXPERIENCE,
    PATH_BOOST_PERSONAL,
    PATH_BOOST_PROJECTS,
    PATH_BOOST_PROJECTS_RESUME,
} from "./km-config";

/** 与 retrieve.ts CandidateRow 对齐 */
export type VectorChunkRow = {
    path: string;
    title: string;
    body: string;
    score?: number;
};

/**
 * KM-02：向量按 chunk 召回时，同一 md path 会出现多次。
 * 按 path 分组，每文件最多保留 MAX_CHUNKS_PER_PATH 段（L2 最优），多段则合并 body。
 */
export const dedupeVectorByPath = (
    chunks: VectorChunkRow[],
    maxPerPath = MAX_CHUNKS_PER_PATH
): VectorChunkRow[] => {
    const byPath = new Map<string, VectorChunkRow[]>();
    for (const c of chunks) {
        const list = byPath.get(c.path) ?? [];
        list.push(c);
        byPath.set(c.path, list);
    }

    const merged: VectorChunkRow[] = [];
    for (const group of byPath.values()) {
        const sorted = [...group].sort(
            (a, b) =>
                (a.score ?? Number.POSITIVE_INFINITY) -
                (b.score ?? Number.POSITIVE_INFINITY)
        );
        const kept = sorted.slice(0, maxPerPath);
        const best = kept[0]!;
        if (kept.length === 1) {
            merged.push(best);
            continue;
        }
        merged.push({
            path: best.path,
            title: best.title,
            body: kept
                .map((k) => k.body)
                .join("\n\n---\n\n")
                .slice(0, MERGED_CHUNK_BODY_MAX),
            score: best.score,
        });
    }

    return merged
        .sort(
            (a, b) =>
                (a.score ?? Number.POSITIVE_INFINITY) -
                (b.score ?? Number.POSITIVE_INFINITY)
        )
        .slice(0, MAX_CANDIDATES);
};

/** Chroma L2 距离 → 0–1 语义相关度（越小越相似）。用于：computeRelevance（KM-05）。 */
export const vectorScoreToRelevance = (score: number | undefined): number => {
    if (typeof score !== "number") return 0;
    return Math.max(0, Math.min(1, 1 - score / 2));
};

/** 字面 token 命中率 → 0–1。用于：computeRelevance（KM-05）。 */
export const computeKeywordRelevance = (
    haystack: string,
    tokens: string[]
): number => {
    if (tokens.length === 0) return 0;
    let matched = 0;
    for (const t of tokens) {
        if (haystack.includes(t)) matched += 1;
    }
    return Math.min(1, matched / tokens.length);
};

/**
 * 按 repo 相对 path 查路径信誉分（KM-03 pathBoost）。
 * 更具体的路径规则在前（如 projects/resume.md 先于 projects/）。
 */
export const getPathBoost = (repoPath: string): number => {
    const p = repoPath.replace(/\\/g, "/").toLowerCase();
    if (p.includes("/projects/resume.md")) return PATH_BOOST_PROJECTS_RESUME;
    if (p.includes("/personal/")) return PATH_BOOST_PERSONAL;
    if (p.includes("/experience/")) return PATH_BOOST_EXPERIENCE;
    if (p.includes("/projects/")) return PATH_BOOST_PROJECTS;
    return 0;
};

/** relevance = token + vector + pathBoost，封顶 1.0（KM-05）。 */
export const computeRelevance = (
    keywordRelevance: number,
    vectorRelevance: number,
    pathBoost: number
): number =>
    Math.min(1, keywordRelevance + vectorRelevance + pathBoost);

export type RankedCandidate = VectorChunkRow & {
    keywordRelevance: number;
    vectorRelevance: number;
    pathBoost: number;
    relevance: number;
    excerpt: string;
};

/**
 * 对候选统一打分排序（KM-05 rank + KM-06 兜底共用）。
 * pickExcerpt 由 retrieve.ts 注入，避免循环依赖。
 */
export const rankCandidates = (
    candidates: VectorChunkRow[],
    tokens: string[],
    pickExcerpt: (body: string, tokens: string[]) => string
): RankedCandidate[] =>
    candidates
        .map((c) => {
            const haystack = `${c.path} ${c.title} ${c.body}`.toLowerCase();
            const keywordRelevance = computeKeywordRelevance(haystack, tokens);
            const vectorRelevance = vectorScoreToRelevance(c.score);
            const pathBoost = getPathBoost(c.path);
            const relevance = computeRelevance(
                keywordRelevance,
                vectorRelevance,
                pathBoost
            );
            const excerpt =
                pickExcerpt(c.body, tokens) ||
                c.body.slice(0, EXCERPT_MAX).trim();
            return {
                ...c,
                keywordRelevance,
                vectorRelevance,
                pathBoost,
                relevance,
                excerpt,
            };
        })
        .sort((a, b) => b.relevance - a.relevance);
