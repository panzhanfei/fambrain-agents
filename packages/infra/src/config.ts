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

const DEFAULT_REDIS_KEY_PREFIX = "fambrain";

/** 从 redis://host:port/N 解析库号；返回去掉 /N 后的 URL */
const splitRedisDbFromUrl = (
    raw: string
): { url: string; dbFromUrl?: number } => {
    const m = raw.match(/^(redis(?:s)?:\/\/[^/?#]+)\/(\d+)(.*)$/i);
    if (!m) return { url: raw };
    const db = Number.parseInt(m[2]!, 10);
    const suffix = m[3] ?? "";
    return {
        url: `${m[1]}${suffix}`,
        dbFromUrl: Number.isFinite(db) ? db : undefined,
    };
};

export const resolveRedisKeyPrefix = (): string => {
    const raw = process.env.REDIS_KEY_PREFIX?.trim();
    return raw || DEFAULT_REDIS_KEY_PREFIX;
};

/** REDIS_URL 优先；显式 REDIS_ENABLED=1 时用 REDIS_HOST+PORT；默认关闭（memory fallback） */
export const resolveRedisUrl = (): string | null => {
    const explicit = process.env.REDIS_URL?.trim();
    if (explicit) return splitRedisDbFromUrl(explicit).url;
    const enabled = process.env.REDIS_ENABLED?.trim().toLowerCase();
    if (enabled !== "1" && enabled !== "true" && enabled !== "yes") {
        return null;
    }
    const host = process.env.REDIS_HOST?.trim() || "127.0.0.1";
    const port = process.env.REDIS_PORT?.trim() || "6379";
    return `redis://${host}:${port}`;
};

/** URL 路径 /N 优先于 REDIS_DB；默认 0 */
export const resolveRedisDb = (): number => {
    const explicit = process.env.REDIS_URL?.trim();
    if (explicit) {
        const { dbFromUrl } = splitRedisDbFromUrl(explicit);
        if (dbFromUrl !== undefined) return dbFromUrl;
    }
    return parseIntEnv(process.env.REDIS_DB, 0, 0);
};

export const buildRetrievalCacheKeyPrefix = (): string => {
    return `${resolveRedisKeyPrefix()}:retrieval:v1`;
};

export const buildCompositeAnswerCacheKeyPrefix = (): string => {
    return `${resolveRedisKeyPrefix()}:composite-answer:v1`;
};

export const buildRateLimitKeyPrefix = (): string => {
    return `${resolveRedisKeyPrefix()}:rl`;
};

export type InfraConfig = {
    redisUrl: string | null;
    redisDb: number;
    redisKeyPrefix: string;
    redisEnabled: boolean;
    retrievalCache: {
        enabled: boolean;
        ttlMs: number;
        maxEntries: number;
        keyPrefix: string;
    };
    compositeAnswerCache: {
        enabled: boolean;
        ttlMs: number;
        maxEntries: number;
        keyPrefix: string;
    };
    /** L1：同会话字面重复问短路 */
    repeatQuestionCache: {
        enabled: boolean;
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
    const redisKeyPrefix = resolveRedisKeyPrefix();
    const redisUrl = resolveRedisUrl();
    const redisDb = resolveRedisDb();
    const redisEnabled = Boolean(redisUrl);
    cached = {
        redisUrl,
        redisDb,
        redisKeyPrefix,
        redisEnabled,
        retrievalCache: {
            enabled: !truthy(process.env.RETRIEVAL_CACHE_DISABLED),
            ttlMs: parseIntEnv(process.env.RETRIEVAL_CACHE_TTL_MS, 900_000, 1000),
            maxEntries: parseIntEnv(process.env.RETRIEVAL_CACHE_MAX_ENTRIES, 256, 16),
            keyPrefix: buildRetrievalCacheKeyPrefix(),
        },
        compositeAnswerCache: {
            enabled: !truthy(process.env.COMPOSITE_ANSWER_CACHE_DISABLED),
            ttlMs: parseIntEnv(
                process.env.COMPOSITE_ANSWER_CACHE_TTL_MS,
                parseIntEnv(process.env.RETRIEVAL_CACHE_TTL_MS, 900_000, 1000),
                1000
            ),
            maxEntries: parseIntEnv(
                process.env.COMPOSITE_ANSWER_CACHE_MAX_ENTRIES,
                128,
                16
            ),
            keyPrefix: buildCompositeAnswerCacheKeyPrefix(),
        },
        repeatQuestionCache: {
            enabled: !truthy(process.env.REPEAT_QUESTION_CACHE_DISABLED),
        },
        pipelineQueue: {
            enabled: truthy(process.env.PIPELINE_QUEUE_ENABLED),
            name:
                process.env.PIPELINE_QUEUE_NAME?.trim() ||
                `${redisKeyPrefix}-pipeline`,
            concurrency: parseIntEnv(process.env.PIPELINE_QUEUE_CONCURRENCY, 2, 1),
            jobTtlMs: parseIntEnv(process.env.PIPELINE_QUEUE_JOB_TTL_MS, 3_600_000, 60_000),
            eventChannelPrefix:
                process.env.PIPELINE_QUEUE_EVENT_PREFIX?.trim() ||
                `${redisKeyPrefix}:pipeline:events`,
        },
    };
    return cached;
};

/** 单测 / 脚本重置 */
export const resetInfraConfigForTests = (): void => {
    cached = null;
};
