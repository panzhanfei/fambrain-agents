import { getInfraConfig } from "../config.ts";
import { getRedisClient, isRedisConfigured } from "../redis/client.ts";
import {
    buildRetrievalCacheKey,
    type RetrievalCacheKeyParts,
} from "./keys.ts";

export { normalizeSearchQuery, buildRetrievalCacheKey } from "./keys.ts";
export type { RetrievalCacheKeyParts } from "./keys.ts";

/** 与 KnowledgeRetrievalResult 对齐的可缓存载荷 */
export type CachedRetrievalPayload = {
    hits: {
        path: string;
        title: string;
        excerpt: string;
        relevance: number;
    }[];
    coverage: "sufficient" | "partial" | "none";
    notes: string | null;
    confidenceTier?: "high" | "mid" | "low";
    confidenceScore?: number;
};

type MemoryEntry = {
    payload: CachedRetrievalPayload;
    expiresAt: number;
};

const memoryStore = new Map<string, MemoryEntry>();

const pruneMemoryIfNeeded = (maxEntries: number): void => {
    if (memoryStore.size <= maxEntries) return;
    const overflow = memoryStore.size - maxEntries;
    const keys = memoryStore.keys();
    for (let i = 0; i < overflow; i++) {
        const k = keys.next().value;
        if (k) memoryStore.delete(k);
    }
};

export const getRetrievalFromCache = async (
    parts: RetrievalCacheKeyParts
): Promise<CachedRetrievalPayload | null> => {
    const cfg = getInfraConfig();
    if (!cfg.retrievalCache.enabled) return null;

    const key = buildRetrievalCacheKey(parts);
    const redis = getRedisClient();
    if (redis) {
        try {
            if (redis.status !== "ready") await redis.connect();
            const raw = await redis.get(key);
            if (!raw) return null;
            return JSON.parse(raw) as CachedRetrievalPayload;
        } catch {
            return null;
        }
    }

    const entry = memoryStore.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
        memoryStore.delete(key);
        return null;
    }
    return entry.payload;
};

export const setRetrievalCache = async (
    parts: RetrievalCacheKeyParts,
    payload: CachedRetrievalPayload
): Promise<void> => {
    const cfg = getInfraConfig();
    if (!cfg.retrievalCache.enabled) return;

    const key = buildRetrievalCacheKey(parts);
    const redis = getRedisClient();
    if (redis) {
        try {
            if (redis.status !== "ready") await redis.connect();
            const ttlSec = Math.max(1, Math.ceil(cfg.retrievalCache.ttlMs / 1000));
            await redis.set(key, JSON.stringify(payload), "EX", ttlSec);
        } catch {
            /* 写入失败不阻断主链 */
        }
        return;
    }

    pruneMemoryIfNeeded(cfg.retrievalCache.maxEntries);
    memoryStore.set(key, {
        payload,
        expiresAt: Date.now() + cfg.retrievalCache.ttlMs,
    });
};

/** verify 脚本：清空内存 fallback（Redis 键靠 TTL 自然过期） */
export const clearMemoryRetrievalCache = (): void => {
    memoryStore.clear();
};

export type RetrievalCacheBackend = "redis" | "memory" | "disabled";

export const getRetrievalCacheBackend = (): RetrievalCacheBackend => {
    const cfg = getInfraConfig();
    if (!cfg.retrievalCache.enabled) return "disabled";
    if (isRedisConfigured()) return "redis";
    return "memory";
};
