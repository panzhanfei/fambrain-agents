import process from "node:process";

const truthy = (raw: string | undefined): boolean => {
    if (raw === undefined) return false;
    const s = raw.trim().toLowerCase();
    return s === "1" || s === "true" || s === "yes";
};

const parseIntEnv = (
    raw: string | undefined,
    fallback: number,
    min: number
): number => {
    const n = Number.parseInt(raw ?? "", 10);
    if (!Number.isFinite(n) || n < min) return fallback;
    return n;
};

/** REDIS_URL 优先；显式 REDIS_ENABLED=1 时用 REDIS_HOST+PORT；默认关闭（memory fallback） */
export const resolveRedisUrl = (): string | null => {
    const explicit = process.env.REDIS_URL?.trim();
    if (explicit) return explicit;
    const enabled = process.env.REDIS_ENABLED?.trim().toLowerCase();
    if (enabled !== "1" && enabled !== "true" && enabled !== "yes") {
        return null;
    }
    const host = process.env.REDIS_HOST?.trim() || "127.0.0.1";
    const port = process.env.REDIS_PORT?.trim() || "6379";
    return `redis://${host}:${port}`;
};

export type InfraConfig = {
    redisUrl: string | null;
    redisEnabled: boolean;
    retrievalCache: {
        enabled: boolean;
        ttlMs: number;
        maxEntries: number;
    };
    pipelineQueue: {
        enabled: boolean;
        name: string;
        concurrency: number;
        jobTtlMs: number;
        eventChannelPrefix: string;
    };
};

let cached: InfraConfig | null = null;

export const getInfraConfig = (): InfraConfig => {
    if (cached) return cached;
    const redisUrl = resolveRedisUrl();
    const redisEnabled = Boolean(redisUrl);
    cached = {
        redisUrl,
        redisEnabled,
        retrievalCache: {
            enabled: !truthy(process.env.RETRIEVAL_CACHE_DISABLED),
            ttlMs: parseIntEnv(process.env.RETRIEVAL_CACHE_TTL_MS, 900_000, 1000),
            maxEntries: parseIntEnv(process.env.RETRIEVAL_CACHE_MAX_ENTRIES, 256, 16),
        },
        pipelineQueue: {
            enabled: truthy(process.env.PIPELINE_QUEUE_ENABLED),
            name: process.env.PIPELINE_QUEUE_NAME?.trim() || "fambrain-pipeline",
            concurrency: parseIntEnv(process.env.PIPELINE_QUEUE_CONCURRENCY, 2, 1),
            jobTtlMs: parseIntEnv(process.env.PIPELINE_QUEUE_JOB_TTL_MS, 3_600_000, 60_000),
            eventChannelPrefix:
                process.env.PIPELINE_QUEUE_EVENT_PREFIX?.trim() ||
                "fambrain:pipeline:events",
        },
    };
    return cached;
};

/** 单测 / 脚本重置 */
export const resetInfraConfigForTests = (): void => {
    cached = null;
};
