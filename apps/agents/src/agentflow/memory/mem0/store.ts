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
        logAgentOut("Mem0", "客户端初始化", {
            ollamaBaseUrl: cfg.ollamaBaseUrl,
            ollamaChatModel: cfg.ollamaChatModel,
            ollamaEmbedModel: cfg.ollamaEmbedModel,
            historyDbPath: cfg.mem0HistoryDbPath,
            vectorCollection: "fambrain_user_memories",
            embeddingDims: 768,
            searchLimit: cfg.mem0SearchLimit,
        });
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
        logAgentOut("Mem0", "search 跳过（MEM0_ENABLED=false）", { userId, query });
        return [];
    }
    const memory = await ensureClient();
    if (!memory)
        return [];
    logAgentIn("Mem0", "search 请求", {
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
        logAgentOut("Mem0", "search 响应", {
            userId,
            query,
            raw,
            extractedCount: texts.length,
            extracted: texts,
        });
        return texts;
    }
    catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        console.warn("[Mem0] search failed:", message);
        logAgentOut("Mem0", "search 失败", { userId, query, error: message });
        return [];
    }
};
export const addTurnToMem0 = async (userId: string, userQuestion: string, assistantAnswer: string): Promise<void> => {
    const cfg = getMemoryConfig();
    if (!cfg.mem0Enabled) {
        logAgentOut("Mem0", "add 跳过（MEM0_ENABLED=false）", { userId });
        return;
    }
    const memory = await ensureClient();
    if (!memory)
        return;
    logAgentIn("Mem0", "add 请求", {
        userId,
        userQuestion,
        assistantAnswer,
        metadata: { source: "fambrain_pipeline" },
    });
    try {
        const result = await memory.add([
            { role: "user", content: userQuestion },
            { role: "assistant", content: assistantAnswer },
        ], { userId, metadata: { source: "fambrain_pipeline" } });
        logAgentOut("Mem0", "add 响应", {
            userId,
            result,
        });
    }
    catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        console.warn("[Mem0] add failed:", message);
        logAgentOut("Mem0", "add 失败", { userId, error: message });
    }
};
