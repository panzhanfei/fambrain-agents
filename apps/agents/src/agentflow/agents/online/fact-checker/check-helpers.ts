import { parseJsonObject } from "@/agentflow/agents/online/information-analyst/analyze-helpers";

import type {
  FactCheckerInput,
  FactCheckerIssue,
  FactCheckerIssueCode,
  FactCheckerResult,
} from "./prompt";

export { parseJsonObject };

const ISSUE_CODES: FactCheckerIssueCode[] = [
  "no_hits_when_needed",
  "hits_irrelevant",
  "coverage_mismatch",
  "excerpt_too_weak",
  "subtask_uncovered",
  "entity_missing",
];

const CJK_RUN = /^[\u4e00-\u9fff]+$/;

function tokenize(...parts: string[]): string[] {
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
}

function buildRefinedSearchQuery(input: FactCheckerInput): string {
  const parts = [
    input.searchQuery.trim(),
    input.userQuestion.trim(),
    ...input.subTasks,
    ...input.topics,
  ].filter(Boolean);
  const merged = [...new Set(parts.join(" ").split(/\s+/).filter(Boolean))].join(
    " "
  );
  return merged.slice(0, 240) || input.userQuestion.trim();
}

function hitMatchScore(
  input: Pick<FactCheckerInput, "searchQuery" | "userQuestion" | "subTasks">,
  excerpt: string,
  path: string
): number {
  const tokens = tokenize(
    input.searchQuery,
    input.userQuestion,
    ...input.subTasks
  );
  if (tokens.length === 0) return 0.5;
  const haystack = `${path} ${excerpt}`.toLowerCase();
  let matched = 0;
  for (const t of tokens) {
    if (haystack.includes(t)) matched += 1;
  }
  return matched / tokens.length;
}

function hitsLookRelevant(input: FactCheckerInput): boolean {
  if (input.hits.length === 0) return false;
  const scores = input.hits.map((h) =>
    hitMatchScore(input, h.excerpt, h.path)
  );
  return Math.max(...scores) >= 0.2;
}

/** LLM 不可用或解析失败时的规则兜底 */
export function buildRuleBasedFactCheck(
  input: FactCheckerInput
): FactCheckerResult {
  if (!input.needsRetrieval) {
    return {
      passed: true,
      evidenceScore: 0.5,
      refinedSearchQuery: null,
      checkerNotes: null,
      issues: [],
    };
  }

  if (input.retryCount >= 1) {
    const noHits = input.hits.length === 0 || input.coverage === "none";
    return {
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
  }

  const issues: FactCheckerIssue[] = [];
  const { hits, coverage } = input;

  if (hits.length === 0 && coverage === "none") {
    const refined = buildRefinedSearchQuery(input);
    return {
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
  }

  if (hits.length > 0 && coverage === "none") {
    issues.push({
      code: "coverage_mismatch",
      message: "有命中片段但 coverage 为 none。",
    });
    return {
      passed: false,
      evidenceScore: 0.25,
      refinedSearchQuery: buildRefinedSearchQuery(input),
      checkerNotes: null,
      issues,
    };
  }

  if (hits.length === 0 && coverage === "sufficient") {
    issues.push({
      code: "coverage_mismatch",
      message: "coverage 为 sufficient 但无 hits。",
    });
    return {
      passed: false,
      evidenceScore: 0.2,
      refinedSearchQuery: buildRefinedSearchQuery(input),
      checkerNotes: null,
      issues,
    };
  }

  if (hits.length > 0 && !hitsLookRelevant(input)) {
    return {
      passed: false,
      evidenceScore: 0.2,
      refinedSearchQuery: buildRefinedSearchQuery(input),
      checkerNotes: null,
      issues: [
        {
          code: "hits_irrelevant",
          message: "命中片段与检索词/用户问题匹配度偏低。",
        },
      ],
    };
  }

  const topRelevance = Math.max(...hits.map((h) => h.relevance), 0);
  const evidenceScore =
    coverage === "sufficient"
      ? Math.max(0.75, topRelevance)
      : coverage === "partial"
        ? Math.max(0.5, topRelevance * 0.9)
        : 0.4;

  let checkerNotes: string | null = null;
  if (coverage === "partial") {
    checkerNotes = "证据部分覆盖，分析师须标注未覆盖点，勿推断具体日期或职级。";
  }

  return {
    passed: true,
    evidenceScore: Math.min(1, evidenceScore),
    refinedSearchQuery: null,
    checkerNotes,
    issues,
  };
}

function normalizeIssue(raw: unknown): FactCheckerIssue | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const code = ISSUE_CODES.find((c) => c === o.code);
  if (!code) return null;
  const message = String(o.message ?? "").trim();
  if (!message) return null;
  return { code, message };
}

/** 校验并规范化模型输出；retryCount≥1 时强制放行 */
export function normalizeFactCheckerResult(
  raw: unknown,
  fallback: FactCheckerResult,
  retryCount: number
): FactCheckerResult {
  if (!raw || typeof raw !== "object") {
    return enforceRetryCap(fallback, retryCount);
  }

  const o = raw as Record<string, unknown>;
  let passed =
    typeof o.passed === "boolean" ? o.passed : fallback.passed;
  const rawScore = Number(o.evidenceScore);
  const evidenceScore = Number.isFinite(rawScore)
    ? Math.min(1, Math.max(0, rawScore))
    : fallback.evidenceScore;

  let refinedSearchQuery =
    o.refinedSearchQuery == null
      ? null
      : String(o.refinedSearchQuery).trim() || null;
  if (passed) refinedSearchQuery = null;

  const checkerNotes =
    o.checkerNotes == null
      ? null
      : String(o.checkerNotes).trim() || null;

  const issues = Array.isArray(o.issues)
    ? o.issues
        .map(normalizeIssue)
        .filter((i): i is FactCheckerIssue => i !== null)
    : fallback.issues;

  const result: FactCheckerResult = {
    passed,
    evidenceScore,
    refinedSearchQuery,
    checkerNotes,
    issues,
  };

  return enforceRetryCap(result, retryCount);
}

function enforceRetryCap(
  result: FactCheckerResult,
  retryCount: number
): FactCheckerResult {
  if (retryCount < 1 || result.passed) return result;
  return {
    passed: true,
    evidenceScore: Math.min(result.evidenceScore, 0.35),
    refinedSearchQuery: null,
    checkerNotes:
      result.checkerNotes ??
      "已重试仍不通过模型标准，强制放行；分析师须声明知识库未覆盖或证据有限。",
    issues: result.issues.length
      ? result.issues
      : [
          {
            code: "no_hits_when_needed",
            message: "已达最大重试，不再打回检索。",
          },
        ],
  };
}
