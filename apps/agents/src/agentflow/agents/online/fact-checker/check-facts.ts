/**
 * FactChecker 主流程：LLM 审查 + 规则兜底 + Zod 规范化。
 */

import {
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import { ChatOllama } from "@langchain/ollama";

import { getAgentsConfig } from "@fambrain/agent-config";
import {
  logAgentIn,
  logAgentOut,
} from "@fambrain/agent-shared/agent-log";
import { recordLangChainOllamaUsage } from "@fambrain/agent-shared/pipeline-run-context";

import { parseJsonObject, textFromResponse } from "@/agentflow/utils";

import {
  applyFactCheckGuards,
  buildRuleBasedFactCheck,
  normalizeFactCheckerResult,
} from "./check-helpers";
import { hasExperienceCorpusHits, hasPersonalCorpusHits } from "./refined-search-query";
import {
  prompt,
  type FactCheckerInput,
  type FactCheckerResult,
} from "./prompt";

const { ollama } = getAgentsConfig();

const llm = new ChatOllama({
  baseUrl: ollama.baseUrl,
  model: ollama.models.intakeCoordinator,
});

const summarizeHits = (input: FactCheckerInput) => {
  return input.hits.map((h, i) => ({
    index: i,
    path: h.path,
    title: h.title,
    relevance: h.relevance,
    excerptPreview: h.excerpt.slice(0, 160),
  }));
};

const summarizeFactCheckOut = (result: FactCheckerResult, extra: Record<string, unknown> = {}) => ({
  passed: result.passed,
  evidenceScore: result.evidenceScore,
  refinedSearchQuery: result.refinedSearchQuery,
  checkerNotes: result.checkerNotes,
  issueCount: result.issues.length,
  issues: result.issues,
  ...extra,
});

export const completeFactCheck = async (
  input: FactCheckerInput
): Promise<FactCheckerResult> => {
  logAgentIn("FactChecker", "进入", {
    userQuestion: input.userQuestion,
    intent: input.intent,
    needsRetrieval: input.needsRetrieval,
    searchQuery: input.searchQuery,
    subTasks: input.subTasks,
    topics: input.topics,
    coverage: input.coverage,
    notes: input.notes,
    retryCount: input.retryCount,
    confidenceTier: input.confidenceTier ?? null,
    retrievalCacheHit: input.retrievalCacheHit ?? false,
    hitCount: input.hits.length,
    hits: summarizeHits(input),
  });

  const fallback = buildRuleBasedFactCheck(input);

  if (
    input.retryCount === 0 &&
    input.hits.length > 0 &&
    input.retrievalCacheHit
  ) {
    const result = buildRuleBasedFactCheck(input);
    logAgentOut("FactChecker", "出去", summarizeFactCheckOut(result, {
      source: "rules_cache_hit_pass",
      guardApplied: "cache_hit_skip_llm",
      willRetryRetrieval: false,
    }));
    return result;
  }

  if (
    input.retryCount === 0 &&
    input.hits.length > 0 &&
    input.confidenceTier === "high"
  ) {
    const result = buildRuleBasedFactCheck(input);
    logAgentOut("FactChecker", "出去", summarizeFactCheckOut(result, {
      source: "rules_high_confidence_pass",
      guardApplied: "tier_skip_llm",
      willRetryRetrieval: false,
    }));
    return result;
  }

  if (
    input.retryCount === 0 &&
    input.hits.length > 0 &&
    hasPersonalCorpusHits(input.hits)
  ) {
    const result = buildRuleBasedFactCheck(input);
    logAgentOut("FactChecker", "出去", summarizeFactCheckOut(result, {
      source: "rules_personal_pass",
      guardApplied: "personal_skip_llm",
      willRetryRetrieval: false,
    }));
    return result;
  }

  if (
    input.retryCount === 0 &&
    input.hits.length >= 3 &&
    input.coverage === "sufficient" &&
    hasExperienceCorpusHits(input.hits) &&
    (input.queryType === "enumeration" ||
      /哪几|哪些|列举|公司|任职/.test(input.userQuestion))
  ) {
    const result = buildRuleBasedFactCheck(input);
    logAgentOut("FactChecker", "出去", summarizeFactCheckOut(result, {
      source: "rules_enumeration_pass",
      guardApplied: "enumeration_skip_llm",
      willRetryRetrieval: false,
    }));
    return result;
  }

  try {
    const humanPayload = JSON.stringify(input, null, 2);
    const ai = await llm.invoke([
      new SystemMessage(prompt),
      new HumanMessage(humanPayload),
    ]);

    const text = textFromResponse(ai.content);
    recordLangChainOllamaUsage(ai, {
        promptText: `${prompt}\n${humanPayload}`,
        completionText: text,
        node: "fact_checker",
    });
    const parsed = parseJsonObject<FactCheckerResult>(text);
    const beforeNormalize = parsed;
    const normalized = normalizeFactCheckerResult(parsed, fallback, input.retryCount);
    const guarded = applyFactCheckGuards(input, normalized);
    const guardApplied =
      guarded.passed && !normalized.passed ? "post_llm_guard" : null;

    logAgentOut("FactChecker", "出去", summarizeFactCheckOut(guarded, {
      source: beforeNormalize === null ? "rules_fallback" : "llm",
      guardApplied,
      willRetryRetrieval:
        !guarded.passed &&
        guarded.refinedSearchQuery !== null &&
        input.retryCount < 1,
    }));
    return guarded;
  }
  catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e);
    const fallbackGuarded = applyFactCheckGuards(input, fallback);
    logAgentOut("FactChecker", "出去", summarizeFactCheckOut(fallbackGuarded, {
      source: "rules_fallback",
      llmError: errorMessage,
    }));
    return fallbackGuarded;
  }
};
