/**
 * 单轮 Pipeline 运行的「隐式上下文」：token 统计 + Agent 日志队列。
 *
 * 为什么用 AsyncLocalStorage？
 * - 一轮对话从 prepareTurnStart 节点 enterWith 起、到 Intake/KM/Analyst 多层 async 调用，若每层传 runStore 参数很啰嗦。
 * - enterWith(runStore) 后，同一条 async 链上的任意深度代码可通过 getStore() 拿到「本轮专属」仓库。
 * - 并发多用户时，每个 HTTP 请求各自 enterWith，互不串数据（类似其他语言的 thread-local，但是 async 版）。
 *
 * 不是事件发布订阅：没有 subscribe/on；是「写时入队、读时 drain」的生产者-消费者模式。
 * - 生产者：logAgentIn/Out → enqueuePipelineLog；LLM 返回 → recordLangChainOllamaUsage
 * - 消费者：stream.ts 的 flushPipelineLogs → drainPipelineLogQueue → yield pipeline_log SSE
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { PipelineLogEntry, PipelineStepName, PipelineTokenUsage } from "@fambrain/brain-types";

/** Ollama / LangChain 单次调用的 prompt、completion token 计数 */
export type OllamaTokenCounts = {
    prompt: number;
    completion: number;
};

/**
 * 本轮 Pipeline 的 token 累加器。
 * stream.ts 在 step 切换时 setActiveNode，各 Agent LLM 调用后 record，finishPipeline 时 snapshot。
 */
export class PipelineTokenTracker {
    private promptTokens = 0;
    private completionTokens = 0;
    private estimated = false;
    private byNode: NonNullable<PipelineTokenUsage["byNode"]> = {};
    private activeNode: PipelineStepName | null = null;

    /** 标记当前 LangGraph step，后续 record 默认归到该 node（除非 options.node 覆盖） */
    setActiveNode(node: PipelineStepName | null): void {
        this.activeNode = node;
    }

    /** 累加一次 LLM 调用的 token；可选按 node 分桶统计 */
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

    /** 导出不可变快照，写入 pipeline_timing.tokens 与 Pipeline 出去日志 */
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

/** 单轮 Pipeline 运行仓库：挂在 AsyncLocalStorage 上，一轮一个实例 */
type PipelineRunStore = {
    tokenTracker: PipelineTokenTracker;
    logQueue: PipelineLogEntry[];
};

/**
 * Node.js 内置：按 async 调用链隔离的键值存储。
 * prepareTurnStart 节点开头 enterWith(runStore)，深层 getStore() 取本轮仓库。
 */
export const pipelineRunStorage = new AsyncLocalStorage<PipelineRunStore>();

/** 全局递增，给 enqueuePipelineLog 生成的 entry.id 用（跨轮唯一即可） */
let logIdSeq = 0;

/** 创建新一轮的空仓库（tokenTracker 从 0 开始，logQueue 空数组） */
export const createPipelineRunStore = (): PipelineRunStore => ({
    tokenTracker: new PipelineTokenTracker(),
    logQueue: [],
});

/** 取当前 async 链上的 tokenTracker；无 enterWith 时返回 null */
export const getPipelineTokenTracker = (): PipelineTokenTracker | null => {
    return pipelineRunStorage.getStore()?.tokenTracker ?? null;
};

/**
 * 取出并清空当前轮的 logQueue（splice 移出，非拷贝）。
 * stream.ts flushPipelineLogs 调用，批量 yield 为 pipeline_log SSE。
 */
export const drainPipelineLogQueue = (): PipelineLogEntry[] => {
    const store = pipelineRunStorage.getStore();
    if (!store?.logQueue.length)
        return [];
    return store.logQueue.splice(0);
};

/**
 * Agent 日志入队（agent-log.ts 的 logAgentIn/Out 调用）。
 * 无 store 时静默丢弃（例如单测未 enterWith）。
 */
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

/** 向当前轮 tokenTracker 记一笔；无 tracker 时 no-op */
export const recordPipelineTokenUsage = (counts: OllamaTokenCounts, options?: {
    estimated?: boolean;
    node?: PipelineStepName;
}): void => {
    getPipelineTokenTracker()?.record(counts, options);
};

/** stream.ts 在 step running/done 时同步 activeNode，便于 LLM record 自动归桶 */
export const setPipelineActiveNode = (node: PipelineStepName | null): void => {
    getPipelineTokenTracker()?.setActiveNode(node);
};

/** 从 LangChain Ollama 消息的 metadata 解析真实 token 计数；解析不到返回 null */
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

/** Ollama 未返回计数时，按字符数 /4 粗算 token（标记 estimated） */
export const estimateTokenUsage = (promptText: string, completionText: string): OllamaTokenCounts => ({
    prompt: Math.max(0, Math.ceil(promptText.length / 4)),
    completion: Math.max(0, Math.ceil(completionText.length / 4)),
});

/**
 * Intake/Analyst 等 LangChain invoke 后的统一入口：
 * 优先 metadata 真实计数，否则估算；写入当前轮 tokenTracker。
 */
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
