import { getAgentsConfig } from "@fambrain/agent-config";
import { logAgentIn, logAgentOut } from "@fambrain/agent-shared/agent-log";
import { streamOllamaNative } from "@fambrain/agent-shared/ollama-native-stream";
import { parseJsonObject } from "@/agentflow/utils";
import { buildFallbackAnswer, normalizeAnalystResult } from "./analyze-helpers";
import {
  prompt,
  type InformationAnalystInput,
  type InformationAnalystResult,
} from "./prompt";
type AnalystStreamChunk =
  | {
      type: "thinking";
      text: string;
    }
  | {
      type: "assistant";
      text: string;
    };
/**
 * 信息分析师流式：thinking / assistant 增量由 pipeline 转发；结束时返回解析结果。
 */
export async function* streamAnalyzeInformation(
  input: InformationAnalystInput
): AsyncGenerator<AnalystStreamChunk, InformationAnalystResult> {
  const fallback = buildFallbackAnswer(input);
  const { ollama } = getAgentsConfig();
  logAgentIn("InformationAnalyst", "进入", {
    userQuestion: input.userQuestion,
    language: input.language,
    hitCount: input.hits.length,
    coverage: input.coverage,
    notes: input.notes,
    hasMemoryBlock: Boolean(input.memoryBlock),
    subTasks: input.subTasks,
    hitPaths: input.hits.map((h) => h.path),
  });
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
    logAgentOut("InformationAnalyst", "出去", {
      source: "llm",
      insufficientEvidence: result.insufficientEvidence,
      confidence: result.confidence,
      citationCount: result.citations.length,
      answerPreview: result.answer.length > 400 ? `${result.answer.slice(0, 400)}…` : result.answer,
    });
    return result;
  } catch (e) {
    logAgentOut("InformationAnalyst", "出去", {
      source: "fallback",
      error: e instanceof Error ? e.message : String(e),
      insufficientEvidence: fallback.insufficientEvidence,
      answerPreview: fallback.answer.length > 400 ? `${fallback.answer.slice(0, 400)}…` : fallback.answer,
    });
    yield { type: "assistant", text: fallback.answer };
    return fallback;
  }
}
