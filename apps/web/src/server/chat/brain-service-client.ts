import type {
  AgentPipelineContext,
  AgentPipelineResult,
  AgentStreamEvent,
  DbChatTurn,
  TurnAbortReason,
} from "@fambrain/brain-types";
import { resolveBrainServiceUrl } from "@fambrain/brain-config/service-url";

type SseMessage = {
  event: string;
  data: string;
};

const parseSseBlock = (block: string): SseMessage | null => {
  let event = "message";
  let data = "";
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    if (line.startsWith("data:")) data = line.slice(5).trim();
  }
  if (!data) return null;
  return { event, data };
};

async function* parseSseStream(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal
): AsyncGenerator<SseMessage> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const onAbort = () => {
    void reader.cancel().catch(() => undefined);
  };
  if (signal) {
    if (signal.aborted) {
      await reader.cancel().catch(() => undefined);
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
  }
  try {
    while (true) {
      if (signal?.aborted) break;
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
  } finally {
    if (signal) signal.removeEventListener("abort", onAbort);
    try {
      reader.releaseLock();
    } catch {
      //
    }
  }
}

/**
 * 调用 Python Brain HTTP 服务（BRAIN_SERVICE_URL）。
 */
export async function* streamAgentPipeline(
  history: DbChatTurn[],
  context: AgentPipelineContext,
  authToken: string,
  options?: { signal?: AbortSignal }
): AsyncGenerator<AgentStreamEvent, AgentPipelineResult> {
  const baseUrl = resolveBrainServiceUrl();
  const res = await fetch(`${baseUrl}/pipeline/stream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify({ history, context }),
    signal: options?.signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      text ||
        `Brain 服务请求失败（HTTP ${res.status}），请确认 pnpm run dev:brain-service 已启动`
    );
  }
  if (!res.body) {
    throw new Error("Brain 服务未返回 SSE 流");
  }
  for await (const msg of parseSseStream(res.body, options?.signal)) {
    if (msg.event === "pipeline_done") {
      const payload = JSON.parse(msg.data) as {
        answer?: string;
        blocks?: AgentPipelineResult["blocks"];
        citations?: AgentPipelineResult["citations"];
        retrievalCacheHit?: boolean;
        retrievalPaths?: AgentPipelineResult["retrievalPaths"];
        timing?: AgentPipelineResult["timing"];
        logs?: AgentPipelineResult["logs"];
        steps?: AgentPipelineResult["steps"];
        aborted?: boolean;
        abortReason?: TurnAbortReason;
        paused?: boolean;
        pauseKind?: AgentPipelineResult["pauseKind"];
        jobId?: string;
        turnId?: string;
      };
      return {
        answer: payload.answer ?? "",
        blocks: payload.blocks,
        citations: payload.citations,
        retrievalCacheHit: payload.retrievalCacheHit,
        retrievalPaths: payload.retrievalPaths,
        timing: payload.timing,
        logs: payload.logs,
        steps: payload.steps,
        aborted: payload.aborted,
        abortReason: payload.abortReason,
        paused: payload.paused,
        pauseKind: payload.pauseKind,
        jobId: payload.jobId,
        turnId: payload.turnId,
      };
    }
    yield JSON.parse(msg.data) as AgentStreamEvent;
  }
  return { answer: "" };
}

/** 显式取消 Brain 侧进行中的 turn（与断流双保险） */
export const cancelAgentPipelineTurn = async (input: {
  authToken: string;
  turnId: string;
  conversationId?: string;
  reason: TurnAbortReason;
}): Promise<{ ok: boolean; aborted: boolean }> => {
  const baseUrl = resolveBrainServiceUrl();
  const res = await fetch(`${baseUrl}/pipeline/cancel`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.authToken}`,
    },
    body: JSON.stringify({
      turnId: input.turnId,
      conversationId: input.conversationId,
      reason: input.reason,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Brain cancel 失败（HTTP ${res.status}）`);
  }
  const data = (await res.json()) as { ok?: boolean; aborted?: boolean };
  return { ok: Boolean(data.ok), aborted: Boolean(data.aborted) };
};

/** 请求图内 Pause（不 abort SSE） */
export const pauseAgentPipelineTurn = async (input: {
  authToken: string;
  turnId: string;
  conversationId?: string;
}): Promise<{ ok: boolean; paused: boolean }> => {
  const baseUrl = resolveBrainServiceUrl();
  const res = await fetch(`${baseUrl}/pipeline/pause`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.authToken}`,
    },
    body: JSON.stringify({
      turnId: input.turnId,
      conversationId: input.conversationId,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Brain pause 失败（HTTP ${res.status}）`);
  }
  const data = (await res.json()) as { ok?: boolean; paused?: boolean };
  return { ok: Boolean(data.ok), paused: Boolean(data.paused) };
};
