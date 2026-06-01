import {
  AIMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import { ChatOllama } from "@langchain/ollama";

import { getAgentsConfig } from "@fambrain/agent-config";
import { logAgentIn, logAgentOut } from "@fambrain/agent-shared/agent-log";

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

/**
 * 事实核查主入口：审查 hits/coverage → passed / refinedSearchQuery。
 */
export async function completeFactCheck(
  input: FactCheckerInput
): Promise<FactCheckerResult> {
  const fallback = buildRuleBasedFactCheck(input);

  logAgentIn("FactChecker", "核查请求", {
    userQuestion: input.userQuestion,
    intent: input.intent,
    needsRetrieval: input.needsRetrieval,
    searchQuery: input.searchQuery,
    hitCount: input.hits.length,
    coverage: input.coverage,
    retryCount: input.retryCount,
  });

  try {
    const ai = await llm.invoke([
      new SystemMessage(prompt),
      new HumanMessage(JSON.stringify(input, null, 2)),
    ]);
    const text = textFromResponse(ai.content);
    const parsed = parseJsonObject<FactCheckerResult>(text);
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

    logAgentOut("FactChecker", "核查结果", result);
    return result;
  } catch (e) {
    logAgentOut("FactChecker", "核查结果（LLM 失败，规则回退）", {
      error: e instanceof Error ? e.message : String(e),
      result: fallback,
    });
    return fallback;
  }
}
