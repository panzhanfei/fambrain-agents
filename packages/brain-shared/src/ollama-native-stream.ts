import { getBrainServiceConfig } from "@fambrain/brain-config";
type ChatMessage = {
    role: string;
    content: string;
};
export type OllamaStreamUsage = {
    promptTokens: number;
    completionTokens: number;
};
const mergeIncremental = (acc: string, chunk: unknown): string => {
    if (typeof chunk !== "string" || chunk.length === 0)
        return acc;
    if (chunk.startsWith(acc))
        return chunk;
    return acc + chunk;
};
const formatOllamaError = (raw: string, status: number, baseUrl: string): string => {
    const t = raw.trim();
    if (!t) {
        return `Ollama 无响应正文（HTTP ${status}），请检查服务是否已启动、OLLAMA_BASE_URL 是否为 ${baseUrl}`;
    }
    try {
        const j = JSON.parse(t) as {
            error?: unknown;
        };
        if (typeof j.error === "string" && j.error.length > 0)
            return j.error;
    }
    catch {
        //
    }
    return t.length > 600 ? `${t.slice(0, 600)}…` : t;
};
export type OllamaStreamChunk = {
    kind: "thinking";
    fullText: string;
} | {
    kind: "content";
    fullText: string;
};
type OllamaNdJson = {
    message?: {
        thinking?: unknown;
        content?: unknown;
    };
    done?: boolean;
    prompt_eval_count?: number;
    eval_count?: number;
};
const parseUsage = (chunk: OllamaNdJson): OllamaStreamUsage | undefined => {
    if (!chunk.done)
        return undefined;
    const promptTokens = Number(chunk.prompt_eval_count ?? 0);
    const completionTokens = Number(chunk.eval_count ?? 0);
    if (!Number.isFinite(promptTokens) && !Number.isFinite(completionTokens))
        return undefined;
    return {
        promptTokens: Number.isFinite(promptTokens) ? promptTokens : 0,
        completionTokens: Number.isFinite(completionTokens) ? completionTokens : 0,
    };
};
const consumeOllamaLine = (line: string, state: {
    thinkingAcc: string;
    contentAcc: string;
    usage?: OllamaStreamUsage;
}): OllamaStreamChunk[] => {
    if (!line.trim())
        return [];
    let chunk: OllamaNdJson;
    try {
        chunk = JSON.parse(line) as OllamaNdJson;
    }
    catch {
        return [];
    }
    const usage = parseUsage(chunk);
    if (usage)
        state.usage = usage;
    const out: OllamaStreamChunk[] = [];
    const m = chunk.message;
    if (m?.thinking !== undefined) {
        const next = mergeIncremental(state.thinkingAcc, m.thinking);
        if (next !== state.thinkingAcc) {
            state.thinkingAcc = next;
            out.push({ kind: "thinking", fullText: state.thinkingAcc });
        }
    }
    if (m?.content !== undefined) {
        const next = mergeIncremental(state.contentAcc, m.content);
        if (next !== state.contentAcc) {
            state.contentAcc = next;
            out.push({ kind: "content", fullText: state.contentAcc });
        }
    }
    return out;
};
/**
 * 直连 Ollama `/api/chat` 流式 NDJSON（供 InformationAnalyst 等需要 thinking 的场景）。
 * 生成器 return 值为 Ollama token 计数（若 Ollama 返回）。
 */
export async function* streamOllamaNative(options: {
    messages: ChatMessage[];
    think?: boolean;
    model?: string;
    signal?: AbortSignal;
}): AsyncGenerator<OllamaStreamChunk, OllamaStreamUsage | undefined> {
    const { ollama } = getBrainServiceConfig();
    const baseUrl = ollama.baseUrl;
    const model = options.model ?? ollama.models.intakeCoordinator;
    const preferThink = options.think ?? ollama.streamThink;
    const post = (useThink: boolean) => fetch(ollama.chatEndpoint, {
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
            throw new Error(formatOllamaError(err2, res.status, baseUrl) ||
                `${formatOllamaError(errText, res.status, baseUrl)}（已尝试关闭 thinking 仍失败）`);
        }
    }
    else if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => "");
        throw new Error(formatOllamaError(errText, res.status, baseUrl));
    }
    const state = {
        thinkingAcc: "",
        contentAcc: "",
        usage: undefined as OllamaStreamUsage | undefined,
    };
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
        const { done, value } = await reader.read();
        if (done)
            break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
            for (const chunk of consumeOllamaLine(line, state)) {
                yield chunk;
            }
        }
    }
    if (buffer.trim()) {
        for (const chunk of consumeOllamaLine(buffer, state)) {
            yield chunk;
        }
    }
    return state.usage;
}
