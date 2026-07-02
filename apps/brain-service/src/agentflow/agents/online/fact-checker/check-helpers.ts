/**
 * FactChecker 规则引擎与相关性启发式。
 *
 * 职责：
 * - 在 LLM 不可用、JSON 解析失败或 Zod 校验失败时，提供确定性兜底结果
 * - 为打回检索生成 refinedSearchQuery（合并 searchQuery / userQuestion / subTasks / topics）
 * - 用轻量 token 匹配估算 hit 与问题的相关度（不依赖 embedding）
 *
 * 分支优先级（自上而下，命中即返回）：
 *   skip_no_retrieval → force_pass_after_retry → pass_personal_corpus
 *   → no_hits_first_attempt → coverage_mismatch_* → hits_irrelevant → pass_with_hits
 */

import type { FactCheckerInput, FactCheckerIssue, FactCheckerResult } from "./prompt";
import { hasExperienceCorpusHits, hasPersonalCorpusHits, mergeRetrySearchQuery } from "./refined-search-query";
import { parseFactCheckerResult } from "./schema";

/** 对外统一命名：LLM 输出经 Zod 校验 + retryCap 后的规范化入口 */
export { parseFactCheckerResult as normalizeFactCheckerResult };

/** 纯中文连续字符段，用于 bigram 切分 */
const CJK_RUN = /^[\u4e00-\u9fff]+$/;

/**
 * 简易分词：英文/数字按非字母数字切分，中文长词额外切 2-gram。
 * 供 hitMatchScore 计算 query 与 excerpt 的字面重合度。
 */
const tokenize = (...parts: string[]): string[] => {
  const raw = parts.join(" ").toLowerCase();
  const segments = raw
    .split(/[^a-z0-9\u4e00-\u9fff]+/i)
    .filter((t) => t.length >= 2);

  const expanded: string[] = [];
  for (const t of segments) {
    expanded.push(t);
    // 中文无空格，长词再切双字提高「城管平台」类匹配的召回
    if (CJK_RUN.test(t) && t.length > 2) {
      for (let i = 0; i < t.length - 1; i++) {
        expanded.push(t.slice(i, i + 2));
      }
    }
  }
  return [...new Set(expanded)];
}

/**
 * 打回再检索时使用的改写 query。
 * 合并 Intake 的 searchQuery、用户原问、subTasks、topics，去重后截断 240 字。
 */
const buildRefinedSearchQuery = (input: FactCheckerInput): string => {
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

/**
 * 单条 hit 与检索词/用户问题的 token 重合比例。
 *
 * @returns 0–1；无 token 时返回 0.5（中性，避免误杀）
 */
const hitMatchScore = (
  input: Pick<FactCheckerInput, "searchQuery" | "userQuestion" | "subTasks">,
  excerpt: string,
  path: string
): number => {
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

/** 任一 hit 的 matchScore ≥ 此阈值即视为「字面相关」 */
const RELEVANCE_THRESHOLD = 0.2;

/** 为每条 hit 计算 matchScore，供日志与 hits_irrelevant 分支使用 */
const scoreHits = (input: FactCheckerInput) => {
  return input.hits.map((h) => ({
    path: h.path,
    title: h.title,
    relevance: h.relevance,
    matchScore: hitMatchScore(input, h.excerpt, h.path),
    excerptPreview: h.excerpt.slice(0, 120),
  }));
}

/**
 * 判断当前 hits 是否与用户问题/检索词有足够字面重叠。
 * 用于规则层识别「向量命中了错误文档」的跑偏场景。
 */
const hitsLookRelevant = (input: FactCheckerInput): boolean => {
  if (input.hits.length === 0) return false;
  const scores = scoreHits(input).map((h) => h.matchScore);
  return Math.max(...scores) >= RELEVANCE_THRESHOLD;
}

/**
 * 规则兜底：不调用 LLM，纯确定性分支产出 FactCheckerResult。
 *
 * 与 LLM 的关系：
 * - completeFactCheck 会先调用本函数得到 fallback
 * - LLM 成功时以模型结果为主，Zod 失败时回退为本函数结果
 * - retryCount≥1 时无论 LLM 判什么，schema 层也会强制 passed=true
 */
export const buildRuleBasedFactCheck = (
  input: FactCheckerInput
): FactCheckerResult => {
  const tokens = tokenize(
    input.searchQuery,
    input.userQuestion,
    ...input.subTasks
  );

  // ── 分支 A：Intake 判定无需查库（闲聊/direct_answer 等）──
  if (!input.needsRetrieval) {
    const result: FactCheckerResult = {
      passed: true,
      evidenceScore: 0.5,
      refinedSearchQuery: null,
      checkerNotes: null,
      issues: [],
    };
    return result;
  }

  // ── 分支 B：已打回重搜过一次，不再循环（与 schema.enforceRetryCap 一致）──
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
    return result;
  }

  const issues: FactCheckerIssue[] = [];
  const { hits, coverage } = input;

  // ── 分支 C：personal/ 语料已有命中 → 直接放行（避免 meta refined 打回毁掉 KM₁）──
  if (hits.length > 0 && hasPersonalCorpusHits(hits)) {
    const topRelevance = Math.max(...hits.map((h) => h.relevance), 0);
    const evidenceScore =
      coverage === "sufficient"
        ? Math.max(0.75, topRelevance)
        : coverage === "partial"
          ? Math.max(0.55, topRelevance * 0.9)
          : Math.max(0.5, topRelevance * 0.85);

    const result: FactCheckerResult = {
      passed: true,
      evidenceScore: Math.min(1, evidenceScore),
      refinedSearchQuery: null,
      checkerNotes:
        coverage === "partial"
          ? "personal 语料已命中，证据部分覆盖，分析师勿推断未覆盖细节。"
          : null,
      issues: [],
    };
    return result;
  }

  // ── 分支 C2：列举问法 + experience 命中且 coverage 充分 → 不重检 KM ──
  if (
    hits.length >= 3 &&
    coverage === "sufficient" &&
    hasExperienceCorpusHits(hits) &&
    (input.queryType === "enumeration" ||
      /哪几|哪些|列举|公司|任职/.test(input.userQuestion))
  ) {
    const topRelevance = Math.max(...hits.map((h) => h.relevance), 0);
    return {
      passed: true,
      evidenceScore: Math.min(1, Math.max(0.75, topRelevance)),
      refinedSearchQuery: null,
      checkerNotes: null,
      issues: [],
    };
  }

  // ── 分支 D：首次检索完全无命中 → 打回，附带更完整的 refinedSearchQuery ──
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
    return result;
  }

  // ── 分支 E：KM 内部状态不一致 — 有 hits 但 coverage 标 none ──
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
    return result;
  }

  // ── 分支 F：KM 内部状态不一致 — coverage sufficient 却无 hits ──
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
    return result;
  }

  // ── 分支 G：有 hits 但与 query 字面匹配度过低（如问 E-HR 命中 Sentinel）──
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
    return result;
  }

  // ── 分支 H：证据可接受，放行给 ContentOrganizer → Analyst ──
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

  const result: FactCheckerResult = {
    passed: true,
    evidenceScore: Math.min(1, evidenceScore),
    refinedSearchQuery: null,
    checkerNotes,
    issues,
  };
  return result;
}

/**
 * LLM 结果后处理：personal/ 放行；meta refined 合并后无增量则 pass、不重检 KM。
 */
export const applyFactCheckGuards = (
  input: FactCheckerInput,
  result: FactCheckerResult
): FactCheckerResult => {
  if (input.retryCount >= 1) {
    return result;
  }

  if (input.hits.length > 0 && hasPersonalCorpusHits(input.hits)) {
    if (result.passed) {
      return result;
    }
    const ruled = buildRuleBasedFactCheck(input);
    return {
      ...ruled,
      checkerNotes:
        result.checkerNotes ??
        ruled.checkerNotes ??
        "personal 语料已命中，保留首轮检索结果。",
    };
  }

  if (!result.passed && result.refinedSearchQuery?.trim()) {
    const { query, shouldRetry } = mergeRetrySearchQuery(
      input,
      result.refinedSearchQuery
    );

    if (!shouldRetry) {
      return {
        ...result,
        passed: true,
        refinedSearchQuery: null,
        checkerNotes:
          result.checkerNotes ??
          "改写检索词无有效增量，保留首轮检索结果。",
        issues: result.issues,
      };
    }

    return {
      ...result,
      refinedSearchQuery: query,
    };
  }

  return result;
};
