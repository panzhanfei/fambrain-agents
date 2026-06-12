import { logAgentStep } from "@fambrain/agent-shared/agent-log";
import { parseJsonObject } from "@/agentflow/utils";
import type { FactCheckerInput, FactCheckerIssue, FactCheckerResult } from "./prompt";
import { parseFactCheckerResult } from "./schema";
export { parseJsonObject };
export { parseFactCheckerResult as normalizeFactCheckerResult };
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
const buildRefinedSearchQuery = (input: FactCheckerInput): string => {
    const parts = [
        input.searchQuery.trim(),
        input.userQuestion.trim(),
        ...input.subTasks,
        ...input.topics,
    ].filter(Boolean);
    const merged = [...new Set(parts.join(" ").split(/\s+/).filter(Boolean))].join(" ");
    return merged.slice(0, 240) || input.userQuestion.trim();
};
const hitMatchScore = (input: Pick<FactCheckerInput, "searchQuery" | "userQuestion" | "subTasks">, excerpt: string, path: string): number => {
    const tokens = tokenize(input.searchQuery, input.userQuestion, ...input.subTasks);
    if (tokens.length === 0)
        return 0.5;
    const haystack = `${path} ${excerpt}`.toLowerCase();
    let matched = 0;
    for (const t of tokens) {
        if (haystack.includes(t))
            matched += 1;
    }
    return matched / tokens.length;
};
const RELEVANCE_THRESHOLD = 0.2;
const scoreHits = (input: FactCheckerInput) => {
    return input.hits.map((h) => ({
        path: h.path,
        title: h.title,
        relevance: h.relevance,
        matchScore: hitMatchScore(input, h.excerpt, h.path),
        excerptPreview: h.excerpt.slice(0, 120),
    }));
};
const hitsLookRelevant = (input: FactCheckerInput): boolean => {
    if (input.hits.length === 0)
        return false;
    const scores = scoreHits(input).map((h) => h.matchScore);
    return Math.max(...scores) >= RELEVANCE_THRESHOLD;
};
export const buildRuleBasedFactCheck = (input: FactCheckerInput): FactCheckerResult => {
    const tokens = tokenize(input.searchQuery, input.userQuestion, ...input.subTasks);
    logAgentStep("FactChecker", "规则兜底 · 开始", {
        needsRetrieval: input.needsRetrieval,
        retryCount: input.retryCount,
        hitCount: input.hits.length,
        coverage: input.coverage,
        searchQuery: input.searchQuery,
        tokens,
        relevanceThreshold: RELEVANCE_THRESHOLD,
    });
    if (!input.needsRetrieval) {
        const result: FactCheckerResult = {
            passed: true,
            evidenceScore: 0.5,
            refinedSearchQuery: null,
            checkerNotes: null,
            issues: [],
        };
        logAgentStep("FactChecker", "规则兜底 · 分支 skip_no_retrieval", {
            reason: "needsRetrieval=false，无需查库，直接放行",
            result,
        });
        return result;
    }
    if (input.retryCount >= 1) {
        const noHits = input.hits.length === 0 || input.coverage === "none";
        const result: FactCheckerResult = {
            passed: true,
            evidenceScore: noHits ? 0.15 : 0.45,
            refinedSearchQuery: null,
            checkerNotes: noHits
                ? "已重试仍无命中，分析师须声明知识库未覆盖，禁止编造经历。"
                : "已重试一次，证据有限，分析师勿推断未覆盖细节。",
            issues: noHits
                ? [
                    {
                        code: "no_hits_when_needed",
                        message: "二次检索仍无命中，不再打回。",
                    },
                ]
                : [],
        };
        logAgentStep("FactChecker", "规则兜底 · 分支 force_pass_after_retry", {
            reason: "retryCount≥1，不再打回检索",
            noHits,
            result,
        });
        return result;
    }
    const issues: FactCheckerIssue[] = [];
    const { hits, coverage } = input;
    if (hits.length === 0 && coverage === "none") {
        const refined = buildRefinedSearchQuery(input);
        const result: FactCheckerResult = {
            passed: false,
            evidenceScore: 0.12,
            refinedSearchQuery: refined,
            checkerNotes: null,
            issues: [
                {
                    code: "no_hits_when_needed",
                    message: "检索无命中，建议用更完整实体与技术词重试。",
                },
            ],
        };
        logAgentStep("FactChecker", "规则兜底 · 分支 no_hits_first_attempt", {
            reason: "hits=0 且 coverage=none，首次检索打回",
            refinedSearchQuery: refined,
            result,
        });
        return result;
    }
    if (hits.length > 0 && coverage === "none") {
        issues.push({
            code: "coverage_mismatch",
            message: "有命中片段但 coverage 为 none。",
        });
        const refined = buildRefinedSearchQuery(input);
        const result: FactCheckerResult = {
            passed: false,
            evidenceScore: 0.25,
            refinedSearchQuery: refined,
            checkerNotes: null,
            issues,
        };
        logAgentStep("FactChecker", "规则兜底 · 分支 coverage_mismatch_hits_none", {
            reason: "有 hits 但 coverage=none",
            hitScores: scoreHits(input),
            refinedSearchQuery: refined,
            result,
        });
        return result;
    }
    if (hits.length === 0 && coverage === "sufficient") {
        issues.push({
            code: "coverage_mismatch",
            message: "coverage 为 sufficient 但无 hits。",
        });
        const refined = buildRefinedSearchQuery(input);
        const result: FactCheckerResult = {
            passed: false,
            evidenceScore: 0.2,
            refinedSearchQuery: refined,
            checkerNotes: null,
            issues,
        };
        logAgentStep("FactChecker", "规则兜底 · 分支 coverage_mismatch_empty_hits_sufficient", {
            reason: "coverage=sufficient 但 hits=0",
            refinedSearchQuery: refined,
            result,
        });
        return result;
    }
    const hitScores = scoreHits(input);
    const maxMatchScore = hitScores.length
        ? Math.max(...hitScores.map((h) => h.matchScore))
        : 0;
    const relevant = hitsLookRelevant(input);
    if (hits.length > 0 && !relevant) {
        const refined = buildRefinedSearchQuery(input);
        const result: FactCheckerResult = {
            passed: false,
            evidenceScore: 0.2,
            refinedSearchQuery: refined,
            checkerNotes: null,
            issues: [
                {
                    code: "hits_irrelevant",
                    message: "命中片段与检索词/用户问题匹配度偏低。",
                },
            ],
        };
        logAgentStep("FactChecker", "规则兜底 · 分支 hits_irrelevant", {
            reason: `maxMatchScore=${maxMatchScore.toFixed(3)} < ${RELEVANCE_THRESHOLD}`,
            hitScores,
            refinedSearchQuery: refined,
            result,
        });
        return result;
    }
    const topRelevance = Math.max(...hits.map((h) => h.relevance), 0);
    const evidenceScore = coverage === "sufficient"
        ? Math.max(0.75, topRelevance)
        : coverage === "partial"
            ? Math.max(0.5, topRelevance * 0.9)
            : 0.4;
    let checkerNotes: string | null = null;
    if (coverage === "partial") {
        checkerNotes = "证据部分覆盖，分析师须标注未覆盖点，勿推断具体日期或职级。";
    }
    const result: FactCheckerResult = {
        passed: true,
        evidenceScore: Math.min(1, evidenceScore),
        refinedSearchQuery: null,
        checkerNotes,
        issues,
    };
    logAgentStep("FactChecker", "规则兜底 · 分支 pass_with_hits", {
        reason: "hits 相关且 coverage 可接受",
        maxMatchScore,
        topRelevance,
        hitScores,
        result,
    });
    return result;
};
