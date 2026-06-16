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

import { parseJsonObject, textFromResponse } from "@/agentflow/utils";

import {
  buildRuleBasedFactCheck,
  normalizeFactCheckerResult,
} from "./check-helpers";
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
    hitCount: input.hits.length,
    hits: summarizeHits(input),
  });

  const fallback = buildRuleBasedFactCheck(input);

  try {
    const humanPayload = JSON.stringify(input, null, 2);
    const ai = await llm.invoke([
      new SystemMessage(prompt),
      new HumanMessage(humanPayload),
    ]);

    const text = textFromResponse(ai.content);
    const parsed = parseJsonObject<FactCheckerResult>(text);
    const beforeNormalize = parsed;
    const result = normalizeFactCheckerResult(
      parsed,
      fallback,
      input.retryCount
    );

    if (
      !result.passed &&
      result.refinedSearchQuery &&
      result.refinedSearchQuery.trim() === input.searchQuery.trim()
    ) {
      const refined = buildRuleBasedFactCheck(input);
      if (refined.refinedSearchQuery) {
        result.refinedSearchQuery = refined.refinedSearchQuery;
      }
    }

    logAgentOut("FactChecker", "出去", summarizeFactCheckOut(result, {
      source: beforeNormalize === null ? "rules_fallback" : "llm",
      willRetryRetrieval:
        !result.passed &&
        result.refinedSearchQuery !== null &&
        input.retryCount < 1,
    }));
    return result;
  }
  catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e);
    logAgentOut("FactChecker", "出去", summarizeFactCheckOut(fallback, {
      source: "rules_fallback",
      llmError: errorMessage,
    }));
    return fallback;
  }
};
