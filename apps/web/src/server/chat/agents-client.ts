import type {
  AgentPipelineContext,
  AgentPipelineResult,
  AgentStreamEvent,
  DbChatTurn,
} from "@fambrain/agent-types";
import { resolveAgentsServiceUrl } from "@fambrain/agent-config/service-url";

type SseMessage = { event: string; data: string };

function parseSseBlock(block: string): SseMessage | null {
  let event = "message";
  let data = "";
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    if (line.startsWith("data:")) data = line.slice(5).trim();
  }
  if (!data) return null;
  return { event, data };
}

async function* parseSseStream(
  body: ReadableStream<Uint8Array>
): AsyncGenerator<SseMessage> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      const msg = parseSseBlock(part.trim());
      if (msg) yield msg;
    }
  }

  if (buffer.trim()) {
    const msg = parseSseBlock(buffer.trim());
    if (msg) yield msg;
  }
}

/**
 * 调用 @fambrain/agents HTTP 服务，复用与进程内 runAgentStream 相同的事件流。
 */
export async function* streamAgentPipeline(
  history: DbChatTurn[],
  context: AgentPipelineContext,
  authToken: string
): AsyncGenerator<AgentStreamEvent, AgentPipelineResult> {
  const baseUrl = resolveAgentsServiceUrl();
  const res = await fetch(`${baseUrl}/pipeline/stream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify({ history, context }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      text || `Agent 服务请求失败（HTTP ${res.status}），请确认 pnpm run dev:agents 已启动`
    );
  }

  if (!res.body) {
    throw new Error("Agent 服务未返回 SSE 流");
  }

  for await (const msg of parseSseStream(res.body)) {
    if (msg.event === "pipeline_done") {
      const payload = JSON.parse(msg.data) as { answer?: string };
      return { answer: payload.answer ?? "" };
    }
    yield JSON.parse(msg.data) as AgentStreamEvent;
  }

  return { answer: "" };
}
