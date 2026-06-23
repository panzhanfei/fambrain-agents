import { AsyncLocalStorage } from "node:async_hooks";
import type { PipelineLogEntry, PipelineStepName, PipelineTokenUsage } from "@fambrain/agent-types";

export type OllamaTokenCounts = {
    prompt: number;
    completion: number;
};

export class PipelineTokenTracker {
    private promptTokens = 0;
    private completionTokens = 0;
    private estimated = false;
    private byNode: NonNullable<PipelineTokenUsage["byNode"]> = {};
    private activeNode: PipelineStepName | null = null;

    setActiveNode(node: PipelineStepName | null): void {
        this.activeNode = node;
    }

    record(counts: OllamaTokenCounts, options?: {
        estimated?: boolean;
        node?: PipelineStepName;
    }): void {
        const node = options?.node ?? this.activeNode ?? undefined;
        const prompt = Math.max(0, Math.round(counts.prompt));
        const completion = Math.max(0, Math.round(counts.completion));
        if (prompt === 0 && completion === 0)
            return;
        this.promptTokens += prompt;
        this.completionTokens += completion;
        if (options?.estimated)
            this.estimated = true;
        if (node) {
            const prev = this.byNode[node] ?? { prompt: 0, completion: 0 };
            this.byNode[node] = {
                prompt: prev.prompt + prompt,
                completion: prev.completion + completion,
            };
        }
    }

    snapshot(): PipelineTokenUsage {
        return {
            promptTokens: this.promptTokens,
            completionTokens: this.completionTokens,
            totalTokens: this.promptTokens + this.completionTokens,
            ...(this.estimated ? { estimated: true } : {}),
            ...(Object.keys(this.byNode).length > 0 ? { byNode: { ...this.byNode } } : {}),
        };
    }
}

type PipelineRunStore = {
    tokenTracker: PipelineTokenTracker;
    logQueue: PipelineLogEntry[];
};

export const pipelineRunStorage = new AsyncLocalStorage<PipelineRunStore>();

let logIdSeq = 0;

export const createPipelineRunStore = (): PipelineRunStore => ({
    tokenTracker: new PipelineTokenTracker(),
    logQueue: [],
});

export const getPipelineTokenTracker = (): PipelineTokenTracker | null => {
    return pipelineRunStorage.getStore()?.tokenTracker ?? null;
};

export const drainPipelineLogQueue = (): PipelineLogEntry[] => {
    const store = pipelineRunStorage.getStore();
    if (!store?.logQueue.length)
        return [];
    return store.logQueue.splice(0);
};

export const enqueuePipelineLog = (entry: Omit<PipelineLogEntry, "id" | "at">): void => {
    const store = pipelineRunStorage.getStore();
    if (!store)
        return;
    store.logQueue.push({
        ...entry,
        id: `log-${++logIdSeq}`,
        at: new Date().toISOString(),
    });
};

export const recordPipelineTokenUsage = (counts: OllamaTokenCounts, options?: {
    estimated?: boolean;
    node?: PipelineStepName;
}): void => {
    getPipelineTokenTracker()?.record(counts, options);
};

export const setPipelineActiveNode = (node: PipelineStepName | null): void => {
    getPipelineTokenTracker()?.setActiveNode(node);
};

export const extractOllamaTokenUsage = (message: {
    response_metadata?: unknown;
    usage_metadata?: unknown;
}): OllamaTokenCounts | null => {
    for (const meta of [message.response_metadata, message.usage_metadata]) {
        if (!meta || typeof meta !== "object")
            continue;
        const m = meta as Record<string, unknown>;
        const prompt = Number(m.prompt_eval_count ??
            m.promptEvalCount ??
            m.prompt_tokens ??
            m.input_tokens);
        const completion = Number(m.eval_count ??
            m.evalCount ??
            m.completion_tokens ??
            m.output_tokens);
        if (Number.isFinite(prompt) || Number.isFinite(completion)) {
            return {
                prompt: Number.isFinite(prompt) ? prompt : 0,
                completion: Number.isFinite(completion) ? completion : 0,
            };
        }
    }
    return null;
};

export const estimateTokenUsage = (promptText: string, completionText: string): OllamaTokenCounts => ({
    prompt: Math.max(0, Math.ceil(promptText.length / 4)),
    completion: Math.max(0, Math.ceil(completionText.length / 4)),
});

export const recordLangChainOllamaUsage = (message: {
    response_metadata?: unknown;
    usage_metadata?: unknown;
}, options: {
    promptText: string;
    completionText: string;
    node?: PipelineStepName;
}): void => {
    const fromMeta = extractOllamaTokenUsage(message);
    if (fromMeta) {
        recordPipelineTokenUsage(fromMeta, { node: options.node });
        return;
    }
    recordPipelineTokenUsage(estimateTokenUsage(options.promptText, options.completionText), {
        estimated: true,
        node: options.node,
    });
};
