import { getAgentsConfig } from "@/agents/config";

type ChatMessage = { role: string; content: string };

function mergeIncremental(acc: string, chunk: unknown): string {
  if (typeof chunk !== "string" || chunk.length === 0) return acc;
  if (chunk.startsWith(acc)) return chunk;
  return acc + chunk;
}

function formatOllamaError(raw: string, status: number, baseUrl: string): string {
  const t = raw.trim();
  if (!t) {
    return `Ollama 无响应正文（HTTP ${status}），请检查服务是否已启动、OLLAMA_BASE_URL 是否为 ${baseUrl}`;
  }
  try {
    const j = JSON.parse(t) as { error?: unknown };
    if (typeof j.error === "string" && j.error.length > 0) return j.error;
  } catch {
    //
  }
  return t.length > 600 ? `${t.slice(0, 600)}…` : t;
}

export type OllamaStreamChunk =
  | { kind: "thinking"; fullText: string }
  | { kind: "content"; fullText: string };

/**
 * 直连 Ollama `/api/chat` 流式 NDJSON（供 InformationAnalyst 等需要 thinking 的场景）。
 */
export async function* streamOllamaNative(options: {
  messages: ChatMessage[];
  think?: boolean;
  model?: string;
  signal?: AbortSignal;
}): AsyncGenerator<OllamaStreamChunk> {
  const { ollama } = getAgentsConfig();
  const baseUrl = ollama.baseUrl;
  const model = options.model ?? ollama.models.intakeCoordinator;
  const preferThink = options.think ?? ollama.streamThink;

  const post = (useThink: boolean) =>
    fetch(ollama.chatEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: options.messages,
        stream: true,
        ...(useThink ? { think: true } : {}),
      }),
      signal: options.signal,
    });

  let res = await post(preferThink);

  if ((!res.ok || !res.body) && preferThink) {
    const errText = await res.text().catch(() => "");
    res = await post(false);
    if (!res.ok || !res.body) {
      const err2 = await res.text().catch(() => "");
      throw new Error(
        formatOllamaError(err2, res.status, baseUrl) ||
          `${formatOllamaError(errText, res.status, baseUrl)}（已尝试关闭 thinking 仍失败）`
      );
    }
  } else if (!res.ok || !res.body) {
    const errText = await res.text().catch(() => "");
    throw new Error(formatOllamaError(errText, res.status, baseUrl));
  }

  let thinkingAcc = "";
  let contentAcc = "";
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;
      let chunk: { message?: { thinking?: unknown; content?: unknown } };
      try {
        chunk = JSON.parse(line) as typeof chunk;
      } catch {
        continue;
      }
      const m = chunk.message;
      if (m?.thinking !== undefined) {
        const next = mergeIncremental(thinkingAcc, m.thinking);
        if (next !== thinkingAcc) {
          thinkingAcc = next;
          yield { kind: "thinking", fullText: thinkingAcc };
        }
      }
      if (m?.content !== undefined) {
        const next = mergeIncremental(contentAcc, m.content);
        if (next !== contentAcc) {
          contentAcc = next;
          yield { kind: "content", fullText: contentAcc };
        }
      }
    }
  }

  if (buffer.trim()) {
    try {
      const chunk = JSON.parse(buffer) as {
        message?: { thinking?: unknown; content?: unknown };
      };
      const m = chunk.message;
      if (m?.thinking !== undefined) {
        thinkingAcc = mergeIncremental(thinkingAcc, m.thinking);
        yield { kind: "thinking", fullText: thinkingAcc };
      }
      if (m?.content !== undefined) {
        contentAcc = mergeIncremental(contentAcc, m.content);
        yield { kind: "content", fullText: contentAcc };
      }
    } catch {
      //
    }
  }
}
