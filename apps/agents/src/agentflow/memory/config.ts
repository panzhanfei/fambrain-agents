import path from "node:path";
import { getAgentsConfig } from "@fambrain/agent-config";
import { findMonorepoRoot } from "@/agentflow/knowledge/repo-root";
const envFlag = (name: string, defaultOn = true): boolean => {
    const raw = process.env[name];
    if (raw === undefined || raw.trim() === "")
        return defaultOn;
    const s = raw.trim().toLowerCase();
    if (s === "1" || s === "true" || s === "yes")
        return true;
    if (s === "0" || s === "false" || s === "no")
        return false;
    return defaultOn;
};
const clampInt = (raw: string | undefined, fallback: number, max: number): number => {
    if (raw === undefined || raw.trim() === "")
        return fallback;
    const n = Number(raw);
    if (!Number.isFinite(n))
        return fallback;
    return Math.min(max, Math.max(1, Math.round(n)));
};
export type MemoryConfig = {
    mem0Enabled: boolean;
    langMemEnabled: boolean;
    mem0HistoryDbPath: string;
    langMemSessionsDir: string;
    langMemSummarizeAfterTurns: number;
    langMemKeepRecentTurns: number;
    mem0SearchLimit: number;
    ollamaBaseUrl: string;
    ollamaChatModel: string;
    ollamaEmbedModel: string;
};
let cached: MemoryConfig | null = null;
export const resetMemoryConfigCache = (): void => {
    cached = null;
};
export const getMemoryConfig = (): MemoryConfig => {
    if (cached)
        return cached;
    const root = findMonorepoRoot();
    const { ollama } = getAgentsConfig();
    cached = {
        mem0Enabled: envFlag("MEM0_ENABLED", true),
        langMemEnabled: envFlag("LANGMEM_ENABLED", true),
        mem0HistoryDbPath: process.env.MEM0_HISTORY_DB_PATH?.trim() ||
            path.join(root, "data/memory/mem0/history.db"),
        langMemSessionsDir: process.env.LANGMEM_SESSIONS_DIR?.trim() ||
            path.join(root, "data/memory/sessions"),
        langMemSummarizeAfterTurns: clampInt(process.env.LANGMEM_SUMMARIZE_AFTER_TURNS, 8, 40),
        langMemKeepRecentTurns: clampInt(process.env.LANGMEM_KEEP_RECENT_TURNS, 4, 20),
        mem0SearchLimit: clampInt(process.env.MEM0_SEARCH_LIMIT, 5, 20),
        ollamaBaseUrl: ollama.baseUrl,
        ollamaChatModel: ollama.models.default,
        ollamaEmbedModel: ollama.models.embed,
    };
    return cached;
};
