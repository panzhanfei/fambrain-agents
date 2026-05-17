import { getAgentsConfig } from "@/agents/config";
import { prompt } from "@/agents/IntakeCoordinator/prompt";

type HistoryRow = { role: string; content: string };

function mergeIncremental(acc: string, chunk: unknown): string {
  if (typeof chunk !== "string" || chunk.length === 0) return acc;
  if (chunk.startsWith(acc)) return chunk;
  return acc + chunk;
}

function buildMessages(history: HistoryRow[]): { role: string; content: string }[] {
  const recent = history.length > 40 ? history.slice(-40) : history;
  return [{ role: "system", content: prompt }, ...recent.map((h) => ({ role: h.role, content: h.content }))];
}

function formatOllamaError(raw: string, status: number, baseUrl: string): string {
  const t = raw.trim();
  if (!t) return `Ollama 无响应正文（HTTP ${status}），请检查服务是否已启动、OLLAMA_BASE_URL 是否为 ${baseUrl}`;
  try {
    const j = JSON.parse(t) as { error?: unknown };
    if (typeof j.error === "string" && j.error.length > 0) return j.error;
  } catch {
    //
  }
  return t.length > 600 ? `${t.slice(0, 600)}…` : t;
}

/**
 * 直连 Ollama `/api/chat` 流式（NDJSON）。带 `think` 时若被拒（不少模型/旧 Ollama），自动再试一次不带 `think`。
 */
export async function streamOllamaChat(options: {
  history: HistoryRow[];
  /** 是否首选 thinking；失败后自动降级为纯流式正文 */
  think: boolean;
  signal?: AbortSignal;
  onThinking: (fullThinking: string) => void;
  onContent: (fullContent: string) => void;
}): Promise<{ thinking: string; content: string }> {
  const { ollama } = getAgentsConfig();
  const messages = buildMessages(options.history);
  const baseUrl = ollama.baseUrl;

  const post = (useThink: boolean) =>
    fetch(ollama.chatEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: ollama.models.intakeCoordinator,
        messages,
        stream: true,
        ...(useThink ? { think: true } : {}),
      }),
      signal: options.signal,
    });

  const preferThink = options.think;
  let res = await post(preferThink);

  if ((!res.ok || !res.body) && preferThink) {
    const errText = await res.text().catch(() => "");
    res = await post(false);
    if (!res.ok || !res.body) {
      const err2 = await res.text().catch(() => "");
      throw new Error(
        formatOllamaError(err2, res.status, baseUrl) ||
          `${formatOllamaError(errText, res.status, baseUrl)}（已尝试关闭 thinking 仍失败）`,
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
          options.onThinking(thinkingAcc);
        }
      }
      if (m?.content !== undefined) {
        const next = mergeIncremental(contentAcc, m.content);
        if (next !== contentAcc) {
          contentAcc = next;
          options.onContent(contentAcc);
        }
      }
    }
  }

  if (buffer.trim()) {
    try {
      const chunk = JSON.parse(buffer) as { message?: { thinking?: unknown; content?: unknown } };
      const m = chunk.message;
      if (m?.thinking !== undefined) {
        thinkingAcc = mergeIncremental(thinkingAcc, m.thinking);
        options.onThinking(thinkingAcc);
      }
      if (m?.content !== undefined) {
        contentAcc = mergeIncremental(contentAcc, m.content);
        options.onContent(contentAcc);
      }
    } catch {
      //
    }
  }

  return { thinking: thinkingAcc, content: contentAcc.trim() };
}
