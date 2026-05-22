import {
  AIMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import { ChatOllama } from "@langchain/ollama";

import { getAgentsConfig } from "@fambrain/agent-config";

import {
  buildFallbackAnswer,
  normalizeAnalystResult,
  parseJsonObject,
} from "./analyze-helpers";
import {
  prompt,
  type InformationAnalystInput,
  type InformationAnalystResult,
} from "./prompt";

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

/** 非流式分析（测试或内部用）；对用户路径请用 streamAnalyzeInformation */
export async function analyzeInformation(
  input: InformationAnalystInput
): Promise<InformationAnalystResult> {
  const fallback = buildFallbackAnswer(input);

  try {
    const ai = await llm.invoke([
      new SystemMessage(prompt),
      new HumanMessage(JSON.stringify(input, null, 2)),
    ]);
    const text = textFromResponse(ai.content);
    const parsed = parseJsonObject<InformationAnalystResult>(text);
    if (!parsed) return fallback;
    return normalizeAnalystResult(parsed, fallback);
  } catch {
    return fallback;
  }
}
