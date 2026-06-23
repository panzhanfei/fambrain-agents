import { mkdir } from "node:fs/promises";
import path from "node:path";
import { logAgentIn, logAgentOut } from "@fambrain/agent-shared/agent-log";
import { Memory } from "mem0ai/oss";
import { getMemoryConfig } from "../config";
type Mem0SearchHit = {
    memory?: string;
    text?: string;
};
let client: Memory | null = null;
const ensureClient = async (): Promise<Memory | null> => {
    const cfg = getMemoryConfig();
    if (!cfg.mem0Enabled)
        return null;
    if (!client) {
        await mkdir(path.dirname(cfg.mem0HistoryDbPath), { recursive: true });
        client = new Memory({
            llm: {
                provider: "ollama",
                config: {
                    model: cfg.ollamaChatModel,
                    url: cfg.ollamaBaseUrl,
                },
            },
            embedder: {
                provider: "ollama",
                config: {
                    model: cfg.ollamaEmbedModel,
                    url: cfg.ollamaBaseUrl,
                    embeddingDims: 768,
                },
            },
            vectorStore: {
                provider: "memory",
                config: {
                    collectionName: "fambrain_user_memories",
                    dimension: 768,
                },
            },
            historyDbPath: cfg.mem0HistoryDbPath,
        });
    }
    return client;
};
const extractMemoryTexts = (payload: unknown): string[] => {
    if (!payload || typeof payload !== "object")
        return [];
    const root = payload as {
        results?: Mem0SearchHit[];
        memories?: Mem0SearchHit[];
    };
    const rows = root.results ?? root.memories ?? [];
    if (!Array.isArray(rows))
        return [];
    return rows
        .map((row) => {
        const text = row.memory ?? row.text;
        return typeof text === "string" ? text.trim() : "";
    })
        .filter((s) => s.length > 0);
};
export const searchUserMemories = async (userId: string, query: string): Promise<string[]> => {
    const cfg = getMemoryConfig();
    if (!cfg.mem0Enabled) {
        logAgentOut("Mem0", "出去", { action: "search", skipped: true, reason: "MEM0_ENABLED=false", userId, query });
        return [];
    }
    const memory = await ensureClient();
    if (!memory)
        return [];
    logAgentIn("Mem0", "进入", {
        action: "search",
        userId,
        query,
        limit: cfg.mem0SearchLimit,
    });
    try {
        const raw = await memory.search(query, {
            userId,
            limit: cfg.mem0SearchLimit,
        });
        const texts = extractMemoryTexts(raw);
        logAgentOut("Mem0", "出去", {
            action: "search",
            userId,
            query,
            extractedCount: texts.length,
            extracted: texts,
        });
        return texts;
    }
    catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        console.warn("[Mem0] search failed:", message);
        logAgentOut("Mem0", "出去", { action: "search", userId, query, error: message, extractedCount: 0 });
        return [];
    }
};
/** P0-16：用户口述联系方式等，显式写入（不依赖轮次后 LLM 抽取） */
export const addExplicitUserMemory = async (
    userId: string,
    memoryText: string,
    metadata?: Record<string, string>
): Promise<void> => {
    const cfg = getMemoryConfig();
    const trimmed = memoryText.trim();
    if (!trimmed) return;
    if (!cfg.mem0Enabled) {
        logAgentOut("Mem0", "出去", {
            action: "add_explicit",
            skipped: true,
            reason: "MEM0_ENABLED=false",
            userId,
        });
        return;
    }
    const memory = await ensureClient();
    if (!memory) return;
    logAgentIn("Mem0", "进入", {
        action: "add_explicit",
        userId,
        memoryText: trimmed,
        metadata,
    });
    try {
        await memory.add(trimmed, {
            userId,
            metadata: { source: "explicit_remember", ...metadata },
        });
        logAgentOut("Mem0", "出去", { action: "add_explicit", userId, ok: true });
    }
    catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        console.warn("[Mem0] add_explicit failed:", message);
        logAgentOut("Mem0", "出去", {
            action: "add_explicit",
            userId,
            ok: false,
            error: message,
        });
        throw e;
    }
};

/** P0-16：结构化 user_fact 写入 Mem0（对话消息 + metadata，避免纯 JSON 触发抽取失败） */
export const addStructuredUserFact = async (input: {
    userId: string;
    factKey: string;
    label: string;
    value: string;
}): Promise<void> => {
    const cfg = getMemoryConfig();
    if (!cfg.mem0Enabled) {
        logAgentOut("Mem0", "出去", {
            action: "add_structured",
            skipped: true,
            reason: "MEM0_ENABLED=false",
            userId: input.userId,
        });
        return;
    }
    const memory = await ensureClient();
    if (!memory) return;
    const content = `${input.label}：${input.value}`;
    logAgentIn("Mem0", "进入", {
        action: "add_structured",
        userId: input.userId,
        factKey: input.factKey,
        label: input.label,
        value: input.value,
    });
    try {
        await memory.add([
            {
                role: "user",
                content: `请记住我的${content}（字段 ${input.factKey}）`,
            },
        ], {
            userId: input.userId,
            metadata: {
                type: "user_fact",
                source: "explicit_remember",
                factKey: input.factKey,
                label: input.label,
                value: input.value,
            },
        });
        logAgentOut("Mem0", "出去", {
            action: "add_structured",
            userId: input.userId,
            ok: true,
        });
    }
    catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        console.warn("[Mem0] add_structured failed:", message);
        logAgentOut("Mem0", "出去", {
            action: "add_structured",
            userId: input.userId,
            ok: false,
            error: message,
        });
        throw e;
    }
};

const uniqueQueries = (parts: Array<string | null | undefined>): string[] => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const p of parts) {
        const q = p?.trim();
        if (!q || seen.has(q)) continue;
        seen.add(q);
        out.push(q);
    }
    return out;
};

/** 按 factKey + label + 用户问句语义检索（无固定词表） */
export const searchUserFactMemories = async (
    userId: string,
    factKey: string,
    factLabel: string,
    userQuestion: string
): Promise<string[]> => {
    const queries = uniqueQueries([
        userQuestion,
        factLabel,
        `${factLabel} ${factKey}`,
        `user_fact ${factKey}`,
    ]);
    const seen = new Set<string>();
    const merged: string[] = [];
    for (const query of queries) {
        for (const text of await searchUserMemories(userId, query)) {
            if (!seen.has(text)) {
                seen.add(text);
                merged.push(text);
            }
        }
    }
    return merged;
};

export const addTurnToMem0 = async (userId: string, userQuestion: string, assistantAnswer: string): Promise<void> => {
    const cfg = getMemoryConfig();
    if (!cfg.mem0Enabled) {
        logAgentOut("Mem0", "出去", { action: "add", skipped: true, reason: "MEM0_ENABLED=false", userId });
        return;
    }
    const memory = await ensureClient();
    if (!memory)
        return;
    logAgentIn("Mem0", "进入", {
        action: "add",
        userId,
        userQuestion,
        assistantAnswerPreview: assistantAnswer.length > 200 ? `${assistantAnswer.slice(0, 200)}…` : assistantAnswer,
    });
    try {
        await memory.add([
            { role: "user", content: userQuestion },
            { role: "assistant", content: assistantAnswer },
        ], { userId, metadata: { source: "fambrain_pipeline" } });
        logAgentOut("Mem0", "出去", { action: "add", userId, ok: true });
    }
    catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        console.warn("[Mem0] add failed:", message);
        logAgentOut("Mem0", "出去", { action: "add", userId, ok: false, error: message });
    }
};
