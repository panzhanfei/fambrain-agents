import {
  AIMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import { ChatOllama } from "@langchain/ollama";

import { getAgentsConfig } from "@fambrain/agent-config";
import { logAgentIn, logAgentOut } from "@fambrain/agent-shared/agent-log";

import { parseJsonObject } from "@/agentflow/json-parse";
import { parseContentSummaryResult } from "./schema";
import {
  prompt,
  type ContentSummarizerInput,
  type ContentSummaryResult,
} from "./prompt";

const MAX_INPUT_CHARS = 12_000;

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

function buildFallback(input: ContentSummarizerInput): ContentSummaryResult {
  const trimmed = input.text.replace(/\s+/g, " ").trim();
  const preview = trimmed.slice(0, 280);
  return {
    title: input.sourceLabel?.split("/").pop() ?? "未命名文档",
    summary: preview.length > 0 ? preview : "（无可用正文）",
    bullets: preview ? [preview.slice(0, 120)] : [],
    keywords: [],
    language: input.language ?? "zh",
    notes: "模型未返回有效 JSON，已使用正文截断兜底。",
  };
}

/** 对一段文本生成结构化摘要（在线 LangGraph 节点调用） */
export async function summarizeContent(
  input: ContentSummarizerInput
): Promise<ContentSummaryResult> {
  const fallback = buildFallback(input);
  const body = input.text.slice(0, MAX_INPUT_CHARS);
  const maxBullets = input.maxBullets ?? 8;

  logAgentIn("ContentSummarizer", "摘要请求", {
    sourceLabel: input.sourceLabel ?? null,
    charCount: body.length,
    language: input.language ?? "zh",
  });

  const response = await llm.invoke([
    new SystemMessage(prompt),
    new HumanMessage(
      [
        `language: ${input.language ?? "zh"}`,
        `maxBullets: ${maxBullets}`,
        input.sourceLabel ? `source: ${input.sourceLabel}` : null,
        "---",
        body,
      ]
        .filter(Boolean)
        .join("\n")
    ),
  ]);

  const rawText = textFromResponse(response.content);
  const parsed = parseJsonObject<unknown>(rawText);
  const result = parseContentSummaryResult(parsed, fallback);

  logAgentOut("ContentSummarizer", "摘要完成", {
    title: result.title,
    bulletCount: result.bullets.length,
    keywordCount: result.keywords.length,
  });

  return result;
}
