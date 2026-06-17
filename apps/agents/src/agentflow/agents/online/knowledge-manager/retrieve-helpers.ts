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
import type { QueryProfile } from "./types";
import type { KnowledgeHit } from "./types";

/** 与 retrieve.ts CandidateRow 对齐 */
export type VectorChunkRow = {
    path: string;
    title: string;
    body: string;
    score?: number;
};

/** KM-16：同 path 多段 body 合并（去重后拼接，封顶 MERGED_CHUNK_BODY_MAX）。 */
export const mergeChunkBodies = (bodies: string[]): string => {
    const unique = bodies.map((b) => b.trim()).filter(Boolean);
    if (unique.length <= 1) return unique[0] ?? "";
    return unique.join("\n\n---\n\n").slice(0, MERGED_CHUNK_BODY_MAX);
};

/**
 * KM-02 / KM-16：按 path 合并候选；向量 chunk 每 path 最多 MAX_CHUNKS_PER_PATH 段。
 */
export const mergeCandidatesByPath = (
    candidates: VectorChunkRow[],
    maxPerPath = MAX_CHUNKS_PER_PATH,
    maxCandidates = MAX_CANDIDATES
): VectorChunkRow[] => {
    const byPath = new Map<string, VectorChunkRow[]>();
    for (const c of candidates) {
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
        merged.push({
            path: best.path,
            title: best.title,
            body: mergeChunkBodies(kept.map((k) => k.body)),
            score: best.score,
        });
    }

    return merged
        .sort(
            (a, b) =>
                (a.score ?? Number.POSITIVE_INFINITY) -
                (b.score ?? Number.POSITIVE_INFINITY)
        )
        .slice(0, maxCandidates);
};

/** KM-02：向量按 chunk 召回时，同一 md path 会出现多次。 */
export const dedupeVectorByPath = (
    chunks: VectorChunkRow[],
    maxPerPath = MAX_CHUNKS_PER_PATH,
    maxCandidates = MAX_CANDIDATES
): VectorChunkRow[] => mergeCandidatesByPath(chunks, maxPerPath, maxCandidates);

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
    pickExcerptFn: (
        body: string,
        tokens: string[],
        queryProfile?: QueryProfile
    ) => string = pickExcerpt,
    queryProfile?: QueryProfile
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
                pickExcerptFn(c.body, tokens, queryProfile) ||
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

/** identity 问法优先摘的表格字段（KM-10） */
export const IDENTITY_TABLE_LABELS = [
    "姓名",
    "名字",
    "出生",
    "年龄",
    "电话",
    "邮箱",
    "职业",
    "学历",
];

const TABLE_SEP_RE = /^\|\s*[-:|\s]+\|?\s*$/;

const pickLinearExcerpt = (
    body: string,
    tokens: string[],
    maxLen = EXCERPT_MAX
): string => {
    const text = body.replace(/\s+/g, " ").trim();
    if (!text) return "";
    const lower = text.toLowerCase();
    let idx = -1;
    for (const t of tokens) {
        const i = lower.indexOf(t);
        if (i >= 0 && (idx < 0 || i < idx)) idx = i;
    }
    if (idx < 0) return text.slice(0, maxLen);
    const start = Math.max(0, idx - 60);
    const slice = text.slice(start, start + maxLen);
    return (
        (start > 0 ? "…" : "") +
        slice +
        (start + maxLen < text.length ? "…" : "")
    );
};

/** KM-10：优先摘 markdown 表格行（如 | 姓名 | xxx |） */
export const pickTableExcerpt = (
    body: string,
    tokens: string[],
    maxLen = EXCERPT_MAX,
    preferIdentityFields = false
): string | null => {
    const rows: string[] = [];
    for (const line of body.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) continue;
        if (TABLE_SEP_RE.test(trimmed)) continue;
        rows.push(trimmed);
    }
    if (rows.length === 0) return null;

    const labelTokens = [
        ...tokens,
        ...(preferIdentityFields ? IDENTITY_TABLE_LABELS : []),
    ];

    const scored = rows
        .map((row) => {
            const lower = row.toLowerCase();
            let score = 0;
            for (const t of labelTokens) {
                if (t.length >= 2 && lower.includes(t.toLowerCase())) score += 1;
            }
            return { row, score };
        })
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score);

    const pickRows =
        scored.length > 0
            ? scored.map((x) => x.row)
            : preferIdentityFields
              ? rows.filter((r) => /姓名|名字/.test(r))
              : [];

    if (pickRows.length === 0) return null;

    const picked: string[] = [];
    let len = 0;
    for (const row of pickRows) {
        const add = (picked.length ? 1 : 0) + row.length;
        if (len + add > maxLen) break;
        picked.push(row);
        len += add;
    }
    return picked.length > 0 ? picked.join("\n") : null;
};

/** KM-10：表格行优先，否则线性截断 */
export const pickExcerpt = (
    body: string,
    tokens: string[],
    queryProfile?: QueryProfile
): string => {
    const preferIdentity = queryProfile === "identity";
    const table = pickTableExcerpt(body, tokens, EXCERPT_MAX, preferIdentity);
    if (table) return table;
    return pickLinearExcerpt(body, tokens, EXCERPT_MAX);
};

export const isPersonalResumePath = (repoPath: string): boolean => {
    const p = repoPath.replace(/\\/g, "/").toLowerCase();
    if (!p.includes("/personal/")) return false;
    if (p.includes("readme")) return false;
    return /\.md$/i.test(p);
};

const personalResumeRank = (repoPath: string): number => {
    const p = repoPath.toLowerCase();
    if (p.includes("个人简历")) return 3;
    if (p.includes("简历")) return 2;
    return 1;
};

/** KM-11：personal/ 下个人简历候选（优先「个人简历」文件名） */
export const findPersonalResumeCandidate = (
    candidates: VectorChunkRow[]
): VectorChunkRow | null => {
    const personal = candidates.filter((c) => isPersonalResumePath(c.path));
    if (personal.length === 0) return null;
    return [...personal].sort(
        (a, b) => personalResumeRank(b.path) - personalResumeRank(a.path)
    )[0]!;
};

/** KM-13：experience/ 下任职 md（不含 README）。 */
export const isExperienceEntryPath = (repoPath: string): boolean => {
    const p = repoPath.replace(/\\/g, "/").toLowerCase();
    if (!p.includes("/experience/")) return false;
    if (p.includes("readme")) return false;
    return /\.md$/i.test(p);
};

/** KM-14：列举型补全 — 每段经历至少 1 hit，优先 experience、剔除 projects。 */
export const applyEnumerationFill = (
    hits: KnowledgeHit[],
    candidates: VectorChunkRow[],
    ranked: RankedCandidate[],
    queryProfile: QueryProfile,
    maxHits: number,
    expectedPaths: string[],
    tokens: string[]
): { hits: KnowledgeHit[]; fillApplied: boolean; filledCount: number } => {
    if (queryProfile !== "enumeration" || expectedPaths.length === 0) {
        return { hits, fillApplied: false, filledCount: 0 };
    }

    const byPath = new Map<string, KnowledgeHit>();
    for (const h of hits) {
        if (!byPath.has(h.path)) byPath.set(h.path, h);
    }

    let fillApplied = false;
    for (const p of expectedPaths) {
        if (byPath.has(p)) continue;
        const fromRanked = ranked.find((r) => r.path === p);
        const fromCand = candidates.find((c) => c.path === p);
        if (fromRanked) {
            byPath.set(p, {
                path: p,
                title: fromRanked.title,
                excerpt: fromRanked.excerpt,
                relevance: Math.max(0.35, fromRanked.relevance),
            });
            fillApplied = true;
        } else if (fromCand) {
            byPath.set(p, {
                path: p,
                title: fromCand.title,
                excerpt:
                    pickExcerpt(fromCand.body, tokens, "enumeration") ||
                    fromCand.body.slice(0, EXCERPT_MAX).trim(),
                relevance: 0.35,
            });
            fillApplied = true;
        }
    }

    const experienceHits: KnowledgeHit[] = [];
    for (const p of expectedPaths) {
        const h = byPath.get(p);
        if (h) experienceHits.push(h);
    }
    experienceHits.sort((a, b) => b.relevance - a.relevance);

    const others = [...byPath.values()]
        .filter(
            (h) =>
                !expectedPaths.includes(h.path) &&
                !h.path.replace(/\\/g, "/").toLowerCase().includes("/projects/")
        )
        .sort((a, b) => b.relevance - a.relevance);

    const newHits = [...experienceHits, ...others].slice(0, maxHits);

    const hadProjects = hits.some((h) =>
        h.path.replace(/\\/g, "/").toLowerCase().includes("/projects/")
    );
    const hasProjects = newHits.some((h) =>
        h.path.replace(/\\/g, "/").toLowerCase().includes("/projects/")
    );
    if (hadProjects && !hasProjects) fillApplied = true;
    if (
        newHits.length !== hits.length ||
        newHits.some((h, i) => h.path !== hits[i]?.path)
    ) {
        fillApplied = true;
    }

    return {
        hits: newHits,
        fillApplied,
        filledCount: experienceHits.length,
    };
};

/** KM-15：列举型 coverage / notes。 */
export const buildEnumerationCoverage = (
    hits: KnowledgeHit[],
    expectedCount: number,
    filledCount: number
): { coverage: "sufficient" | "partial" | "none"; notes: string | null } => {
    if (expectedCount === 0) {
        const top = hits[0]?.relevance ?? 0;
        return {
            coverage: top >= 0.6 ? "sufficient" : top > 0 ? "partial" : "none",
            notes: null,
        };
    }

    const notes =
        filledCount >= expectedCount
            ? `列举已覆盖 ${filledCount}/${expectedCount} 段经历。`
            : `列举覆盖 ${filledCount}/${expectedCount} 段经历，部分任职文档未进入 hits。`;

    const top = hits[0]?.relevance ?? 0;
    const coverage =
        filledCount >= expectedCount && top >= 0.35
            ? "sufficient"
            : filledCount > 0
              ? "partial"
              : "none";

    return { coverage, notes };
};

/** KM-11：identity 问法强制 personal 简历 Top1，同 path 去重 */
export const applyIdentityGuard = (
    hits: KnowledgeHit[],
    candidates: VectorChunkRow[],
    ranked: RankedCandidate[],
    queryProfile: QueryProfile,
    maxHits: number,
    tokens: string[]
): { hits: KnowledgeHit[]; guardApplied: boolean } => {
    if (queryProfile !== "identity") {
        return { hits, guardApplied: false };
    }

    const personal = findPersonalResumeCandidate(candidates);
    if (!personal) return { hits, guardApplied: false };

    if (hits[0]?.path === personal.path) {
        return { hits, guardApplied: false };
    }

    const rankedPersonal = ranked.find((r) => r.path === personal.path);
    const excerpt =
        rankedPersonal?.excerpt ??
        pickExcerpt(personal.body, tokens, "identity");
    const relevance = Math.max(
        rankedPersonal?.relevance ?? 0,
        hits[0]?.relevance ?? 0,
        0.35
    );

    const topHit: KnowledgeHit = {
        path: personal.path,
        title: personal.title,
        excerpt,
        relevance,
    };

    const rest = hits.filter((h) => h.path !== personal.path);
    return {
        hits: [topHit, ...rest].slice(0, maxHits),
        guardApplied: true,
    };
};
