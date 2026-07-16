import {
    EXCERPT_MAX,
    MAX_CANDIDATES,
    MAX_CHUNKS_PER_PATH,
    MERGED_CHUNK_BODY_MAX,
    PATH_BOOST_EXPERIENCE,
    PATH_BOOST_PERSONAL,
    PATH_BOOST_PROJECTS,
    PATH_BOOST_LEARNED,
    PATH_BOOST_PROJECTS_RESUME,
    FEEDBACK_BOOST_MAX,
} from "../profile/km-config";
import type { QueryProfile, KnowledgeHit } from "../contract/types";

/** 与 retrieve.ts CandidateRow / KnowledgeCandidate 对齐 */
export type VectorChunkRow = {
    path: string;
    title: string;
    body: string;
    score?: number;
    rawScore?: number;
    recallChannel?: "vector" | "sparse" | "hybrid";
    fusionScore?: number;
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
            rawScore: best.rawScore,
            recallChannel: best.recallChannel,
            fusionScore: best.fusionScore,
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

/** Chroma 欧氏距离 → 0–1 语义相关度（越小越相似）。用于：computeRelevance（KM-05）。 */
export const vectorScoreToRelevance = (score: number | undefined): number => {
    if (typeof score !== "number") return 0;
    return Math.max(0, Math.min(1, 1 - score / 2));
};

/** BM25 raw score → 0–1（HY-05 sparse 通道 rank 用）。 */
export const sparseScoreToRelevance = (bm25: number | undefined): number => {
    if (typeof bm25 !== "number" || bm25 <= 0) return 0;
    return Math.min(1, bm25 / (bm25 + 4));
};

const resolveRecallRelevance = (c: VectorChunkRow): number => {
    const vectorRel = vectorScoreToRelevance(c.score);
    const sparseRel = sparseScoreToRelevance(c.rawScore);
    if (c.recallChannel === "sparse") return sparseRel;
    if (c.recallChannel === "hybrid") return Math.max(vectorRel, sparseRel);
    return vectorRel;
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
    if (p.includes("/learned/")) return PATH_BOOST_LEARNED;
    if (p.includes("/personal/")) return PATH_BOOST_PERSONAL;
    if (p.includes("/experience/")) return PATH_BOOST_EXPERIENCE;
    if (p.includes("/projects/")) return PATH_BOOST_PROJECTS;
    return 0;
};

const feedbackDelta = (
    repoPath: string,
    feedbackByPath?: Map<string, number>
): number => {
    if (!feedbackByPath?.size) return 0;
    const signal = feedbackByPath.get(repoPath);
    if (signal === undefined) return 0;
    return Math.max(
        -FEEDBACK_BOOST_MAX,
        Math.min(FEEDBACK_BOOST_MAX, signal * FEEDBACK_BOOST_MAX)
    );
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
    queryProfile?: QueryProfile,
    feedbackByPath?: Map<string, number>
): RankedCandidate[] =>
    candidates
        .map((c) => {
            const haystack = `${c.path} ${c.title} ${c.body}`.toLowerCase();
            const keywordRelevance = computeKeywordRelevance(haystack, tokens);
            const vectorRelevance = resolveRecallRelevance(c);
            const pathBoost = getPathBoost(c.path);
            const relevance = Math.min(
                1,
                computeRelevance(keywordRelevance, vectorRelevance, pathBoost) +
                    feedbackDelta(c.path, feedbackByPath)
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

/** identity 语料表列名常量（非用户问句词表；KM-10） */
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
    preferFields: string[] = []
): string | null => {
    const rows: string[] = [];
    for (const line of body.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) continue;
        if (TABLE_SEP_RE.test(trimmed)) continue;
        rows.push(trimmed);
    }
    if (rows.length === 0) return null;

    const labelTokens = [...tokens, ...preferFields];

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
            : preferFields.length > 0
              ? rows.filter((r) =>
                    preferFields.some(
                        (f) =>
                            f.length >= 2 &&
                            r.toLowerCase().includes(f.toLowerCase())
                    )
                )
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

/** 优先截取含 URL / 已知 host 的段落（external_link profile；结构信号） */
const pickLinkExcerpt = (body: string, maxLen: number): string | null => {
    const lines = body.split("\n").map((l) => l.trim()).filter(Boolean);
    const linkLines = lines.filter((l) =>
        /https?:\/\/|github\.com|gitlab\.com|gitee\.com/i.test(l)
    );
    if (linkLines.length === 0) return null;
    let picked = "";
    for (const line of linkLines) {
        const add = (picked ? 1 : 0) + line.length;
        if (picked.length + add > maxLen) break;
        picked += (picked ? "\n" : "") + line;
    }
    return picked || linkLines[0]!.slice(0, maxLen);
};

/** 工作经历时间线表：含 YYYY 与区间符的行（供 tenure / 任职推算） */
const pickTimelineTableExcerpt = (
    body: string,
    maxLen: number
): string | null => {
    const rows: string[] = [];
    for (const line of body.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) continue;
        if (TABLE_SEP_RE.test(trimmed)) continue;
        if (!/\d{4}/.test(trimmed) || !/[-–—~至到]/.test(trimmed)) continue;
        rows.push(trimmed);
    }
    if (rows.length === 0) return null;
    const picked: string[] = [];
    let len = 0;
    for (const row of rows) {
        const add = (picked.length ? 1 : 0) + row.length;
        if (len + add > maxLen) break;
        picked.push(row);
        len += add;
    }
    return picked.length > 0 ? picked.join("\n") : null;
};

/** tenure 检索模板词：命中时优先摘时间线表，避免基本信息表占满 excerpt */
const TENURE_EXCERPT_SIGNALS = ["工作经历", "时间线", "时间段", "任职"];

const tokensWantTimeline = (tokens: string[]): boolean => {
    const hay = tokens.join(" ").toLowerCase();
    return TENURE_EXCERPT_SIGNALS.some((s) => hay.includes(s.toLowerCase()));
};

/** KM-10：表格行优先，否则线性截断 */
export const pickExcerpt = (
    body: string,
    tokens: string[],
    queryProfile?: QueryProfile
): string => {
    if (queryProfile === "external_link") {
        const link = pickLinkExcerpt(body, EXCERPT_MAX);
        if (link) return link;
    }
    const preferFields =
        queryProfile === "identity" ? IDENTITY_TABLE_LABELS : [];
    const tableBudget =
        queryProfile === "identity" ? EXCERPT_MAX * 3 : EXCERPT_MAX;
    if (queryProfile === "identity" && tokensWantTimeline(tokens)) {
        const timeline = pickTimelineTableExcerpt(body, tableBudget);
        if (timeline) return timeline;
    }
    const table = pickTableExcerpt(body, tokens, tableBudget, preferFields);
    if (table) return table;
    if (queryProfile === "identity") {
        const timeline = pickTimelineTableExcerpt(body, tableBudget);
        if (timeline) return timeline;
    }
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

/** KM-13b：projects/ 下项目 md（不含模板/resume）。 */
export const isProjectEntryPath = (repoPath: string): boolean => {
    const p = repoPath.replace(/\\/g, "/").toLowerCase();
    if (!p.includes("/projects/")) return false;
    if (p.includes("readme") || p.includes("_template")) return false;
    if (p.endsWith("/projects/resume.md")) return false;
    return /\.md$/i.test(p);
};

/** KM-14：列举型补全 — experience 或 project 专扫路径。 */
export const applyEnumerationFill = (
    hits: KnowledgeHit[],
    candidates: VectorChunkRow[],
    ranked: RankedCandidate[],
    queryProfile: QueryProfile,
    maxHits: number,
    expectedPaths: string[],
    tokens: string[],
    target: "experience" | "project" = "experience"
): { hits: KnowledgeHit[]; fillApplied: boolean; filledCount: number } => {
    if (queryProfile !== "enumeration" || expectedPaths.length === 0) {
        return { hits, fillApplied: false, filledCount: 0 };
    }

    const isTargetPath = (p: string) =>
        target === "project"
            ? isProjectEntryPath(p)
            : isExperienceEntryPath(p);

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

    const primaryHits: KnowledgeHit[] = [];
    for (const p of expectedPaths) {
        const h = byPath.get(p);
        if (h) primaryHits.push(h);
    }
    primaryHits.sort((a, b) => b.relevance - a.relevance);

    const others = [...byPath.values()]
        .filter(
            (h) =>
                !expectedPaths.includes(h.path) &&
                isTargetPath(h.path) &&
                (target === "project"
                    ? !h.path.replace(/\\/g, "/").toLowerCase().includes("/experience/")
                    : !h.path.replace(/\\/g, "/").toLowerCase().includes("/projects/"))
        )
        .sort((a, b) => b.relevance - a.relevance);

    const newHits = [...primaryHits, ...others].slice(0, maxHits);

    if (
        newHits.length !== hits.length ||
        newHits.some((h, i) => h.path !== hits[i]?.path)
    ) {
        fillApplied = true;
    }

    return {
        hits: newHits,
        fillApplied,
        filledCount: primaryHits.length,
    };
};

/** KM-15：列举型 coverage / notes。 */
export const buildEnumerationCoverage = (
    hits: KnowledgeHit[],
    expectedCount: number,
    filledCount: number,
    entityLabel: "经历" | "项目" = "经历"
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
            ? `列举已覆盖 ${filledCount}/${expectedCount} 个${entityLabel}。`
            : `列举覆盖 ${filledCount}/${expectedCount} 个${entityLabel}，部分文档未进入 hits。`;

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

const bodyHasPublicUrl = (body: string): boolean =>
    /https?:\/\/[^\s)>]+/i.test(body);

/** KM-11b：external_link 优先 personal 简历 + 含 URL 的 project 文档 */
export const applyExternalLinkGuard = (
    hits: KnowledgeHit[],
    candidates: VectorChunkRow[],
    ranked: RankedCandidate[],
    queryProfile: QueryProfile,
    maxHits: number,
    tokens: string[]
): { hits: KnowledgeHit[]; guardApplied: boolean } => {
    if (queryProfile !== "external_link") {
        return { hits, guardApplied: false };
    }

    const personal = findPersonalResumeCandidate(candidates);
    const withUrl = candidates.filter((c) => bodyHasPublicUrl(c.body));
    const priorityPaths = new Set<string>();
    if (personal) priorityPaths.add(personal.path);
    for (const c of withUrl) priorityPaths.add(c.path);

    if (priorityPaths.size === 0) {
        return { hits, guardApplied: false };
    }

    const boosted: KnowledgeHit[] = [];
    for (const path of priorityPaths) {
        const cand = candidates.find((c) => c.path === path);
        if (!cand) continue;
        const rankedRow = ranked.find((r) => r.path === path);
        boosted.push({
            path: cand.path,
            title: cand.title,
            excerpt:
                rankedRow?.excerpt ??
                pickExcerpt(cand.body, tokens, "external_link"),
            relevance: Math.max(rankedRow?.relevance ?? 0, hits[0]?.relevance ?? 0, 0.4),
        });
    }

    const rest = hits.filter((h) => !priorityPaths.has(h.path));
    return {
        hits: [...boosted, ...rest].slice(0, maxHits),
        guardApplied: true,
    };
};
