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
