import {
  AIMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import { ChatOllama } from "@langchain/ollama";

import { getAgentsConfig } from "@/agents/config";
import { prompt } from "./prompt";

import type { DbChatTurn } from "@/agents/types";

export type { DbChatTurn };

const { ollama } = getAgentsConfig();

const llm = new ChatOllama({
  baseUrl: ollama.baseUrl,
  model: ollama.models.intakeCoordinator,
});

function turnToMessage(t: DbChatTurn) {
  if (t.role === "user") return new HumanMessage(t.content);
  if (t.role === "assistant") return new AIMessage(t.content);
  return new SystemMessage(t.content);
}

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

/** 服务端对接 Ollama：系统指令 + 最近轮次，`invoke` 一次拿回复 */
export async function completeIntakeCoordinator(
  history: DbChatTurn[]
): Promise<string> {
  const recent = history.length > 40 ? history.slice(-40) : history;
  const ai = await llm.invoke([
    new SystemMessage(prompt),
    ...recent.map(turnToMessage),
  ]);

  return (
    textFromResponse(ai.content) ||
    "（模型未返回助手文本：请确认 Ollama 已启动且模型已拉取）"
  );
}
