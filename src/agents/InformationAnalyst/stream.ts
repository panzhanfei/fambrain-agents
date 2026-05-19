import { getAgentsConfig } from "@/agents/config";
import { logAgentIn, logAgentOut } from "@/agents/shared/agent-log";
import { streamOllamaNative } from "@/agents/shared/ollama-native-stream";

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

export type AnalystStreamChunk =
  | { type: "thinking"; text: string }
  | { type: "assistant"; text: string };

/**
 * 信息分析师流式：thinking / assistant 增量由 pipeline 转发；结束时返回解析结果。
 */
export async function* streamAnalyzeInformation(
  input: InformationAnalystInput
): AsyncGenerator<AnalystStreamChunk, InformationAnalystResult> {
  const fallback = buildFallbackAnswer(input);
  const { ollama } = getAgentsConfig();

  logAgentIn("InformationAnalyst", "分析请求", input);

  try {
    const messages = [
      { role: "system", content: prompt },
      { role: "user", content: JSON.stringify(input, null, 2) },
    ];

    let fullContent = "";

    for await (const chunk of streamOllamaNative({
      messages,
      think: ollama.streamThink,
      model: ollama.models.intakeCoordinator,
    })) {
      if (chunk.kind === "thinking") {
        yield { type: "thinking", text: chunk.fullText };
      } else {
        fullContent = chunk.fullText;
        yield { type: "assistant", text: chunk.fullText };
      }
    }

    const parsed = parseJsonObject<InformationAnalystResult>(fullContent);
    const result = normalizeAnalystResult(parsed, fallback);

    if (result.answer !== fullContent.trim()) {
      yield { type: "assistant", text: result.answer };
    }

    logAgentOut("InformationAnalyst", "分析结果（解析后）", result);
    return result;
  } catch (e) {
    logAgentOut("InformationAnalyst", "分析结果（异常回退）", {
      error: e instanceof Error ? e.message : String(e),
      result: fallback,
    });
    yield { type: "assistant", text: fallback.answer };
    return fallback;
  }
}
