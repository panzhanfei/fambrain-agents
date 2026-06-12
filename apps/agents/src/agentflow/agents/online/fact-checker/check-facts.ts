import {
  AIMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import { ChatOllama } from "@langchain/ollama";

import { getAgentsConfig } from "@fambrain/agent-config";
import {
  logAgentIn,
  logAgentOut,
  logAgentStep,
} from "@fambrain/agent-shared/agent-log";

import {
  buildRuleBasedFactCheck,
  normalizeFactCheckerResult,
  parseJsonObject,
} from "./check-helpers";
import { prompt, type FactCheckerInput, type FactCheckerResult } from "./prompt";

const { ollama } = getAgentsConfig();

const llm = new ChatOllama({
  baseUrl: ollama.baseUrl,
  model: ollama.models.intakeCoordinator,
});

function textFromResponse(content: AIMessage["content"]): string {
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((p) =>
        typeof p === "string"
          ? p
          : p &&
              typeof p === "object" &&
              "text" in p &&
              typeof (p as { text: string }).text === "string"
            ? (p as { text: string }).text
            : ""
      )
      .join("")
      .trim();
  }
  return "";
}

function summarizeHits(input: FactCheckerInput) {
  return input.hits.map((h, i) => ({
    index: i,
    path: h.path,
    title: h.title,
    relevance: h.relevance,
    excerptPreview: h.excerpt.slice(0, 160),
  }));
}

/**
 * 事实核查主入口：审查 hits/coverage → passed / refinedSearchQuery。
 */
export async function completeFactCheck(
  input: FactCheckerInput
): Promise<FactCheckerResult> {
  logAgentIn("FactChecker", "步骤1 · 完整输入", {
    userQuestion: input.userQuestion,
    intent: input.intent,
    needsRetrieval: input.needsRetrieval,
    searchQuery: input.searchQuery,
    subTasks: input.subTasks,
    topics: input.topics,
    language: input.language,
    coverage: input.coverage,
    notes: input.notes,
    retryCount: input.retryCount,
    hitCount: input.hits.length,
    hits: summarizeHits(input),
  });

  logAgentStep("FactChecker", "步骤2 · 预计算规则兜底", {
    model: ollama.models.intakeCoordinator,
    baseUrl: ollama.baseUrl,
  });
  const fallback = buildRuleBasedFactCheck(input);
  logAgentStep("FactChecker", "步骤2 · 规则兜底结果", fallback);

  try {
    const humanPayload = JSON.stringify(input, null, 2);
    logAgentStep("FactChecker", "步骤3 · 调用 LLM", {
      model: ollama.models.intakeCoordinator,
      systemPromptChars: prompt.length,
      humanMessageChars: humanPayload.length,
    });

    const ai = await llm.invoke([
      new SystemMessage(prompt),
      new HumanMessage(humanPayload),
    ]);

    const text = textFromResponse(ai.content);
    logAgentStep("FactChecker", "步骤4 · LLM 原始回复", {
      responseChars: text.length,
      rawText: text,
    });

    const parsed = parseJsonObject<FactCheckerResult>(text);
    logAgentStep("FactChecker", "步骤5 · JSON 解析", {
      parseOk: parsed !== null,
      parsed,
    });

    const beforeNormalize = parsed;
    const result = normalizeFactCheckerResult(
      parsed,
      fallback,
      input.retryCount
    );
    logAgentStep("FactChecker", "步骤6 · Zod 规范化后", {
      usedFallback: beforeNormalize === null,
      llmPassed: beforeNormalize?.passed,
      finalPassed: result.passed,
      changedFromLlm:
        beforeNormalize !== null &&
        (beforeNormalize.passed !== result.passed ||
          beforeNormalize.evidenceScore !== result.evidenceScore ||
          beforeNormalize.refinedSearchQuery !== result.refinedSearchQuery),
      result,
    });

    if (
      !result.passed &&
      result.refinedSearchQuery &&
      result.refinedSearchQuery.trim() === input.searchQuery.trim()
    ) {
      logAgentStep("FactChecker", "步骤7 · refined 与旧 query 相同，规则补改写", {
        unchangedQuery: input.searchQuery,
        llmRefined: result.refinedSearchQuery,
      });
      const refined = buildRuleBasedFactCheck(input);
      if (refined.refinedSearchQuery) {
        logAgentStep("FactChecker", "步骤7 · 规则补改写结果", {
          before: result.refinedSearchQuery,
          after: refined.refinedSearchQuery,
        });
        result.refinedSearchQuery = refined.refinedSearchQuery;
      }
    }

    logAgentStep("FactChecker", "步骤8 · 最终判定", {
      passed: result.passed,
      evidenceScore: result.evidenceScore,
      willRetryRetrieval:
        !result.passed && result.refinedSearchQuery !== null && input.retryCount < 1,
      refinedSearchQuery: result.refinedSearchQuery,
      checkerNotes: result.checkerNotes,
      issues: result.issues,
    });
    logAgentOut("FactChecker", "步骤8 · 核查完成", result);
    return result;
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e);
    logAgentStep("FactChecker", "异常 · LLM 调用失败，使用规则兜底", {
      error: errorMessage,
      fallback,
    });
    logAgentOut("FactChecker", "核查结果（LLM 失败，规则回退）", {
      error: errorMessage,
      result: fallback,
    });
    return fallback;
  }
}
