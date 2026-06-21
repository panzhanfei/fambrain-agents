import Redis from "ioredis";
import { getInfraConfig } from "../config";

let client: Redis | null = null;
let clientUrl: string | null = null;

export const isRedisConfigured = (): boolean => {
    return Boolean(getInfraConfig().redisUrl);
};

const redisClientCacheKey = (url: string, db: number): string => `${url}#${db}`;

export const getRedisClient = (): Redis | null => {
    const { redisUrl, redisDb } = getInfraConfig();
    if (!redisUrl) return null;
    const cacheKey = redisClientCacheKey(redisUrl, redisDb);
    if (client && clientUrl === cacheKey) return client;
    if (client) {
        client.disconnect();
        client = null;
    }
    client = new Redis(redisUrl, {
        db: redisDb,
        maxRetriesPerRequest: null,
        lazyConnect: true,
    });
    clientUrl = cacheKey;
    return client;
};

export const createRedisConnection = (): Redis => {
    const { redisUrl, redisDb } = getInfraConfig();
    if (!redisUrl) {
        throw new Error("REDIS_URL / REDIS_HOST 未配置，无法创建 Redis 连接");
    }
    return new Redis(redisUrl, {
        db: redisDb,
        maxRetriesPerRequest: null,
    });
};

export const closeRedisClient = async (): Promise<void> => {
    if (!client) return;
    await client.quit();
    client = null;
    clientUrl = null;
};

export const pingRedis = async (): Promise<boolean> => {
    const redis = getRedisClient();
    if (!redis) return false;
    try {
        if (redis.status !== "ready") {
            await redis.connect();
        }
        const pong = await redis.ping();
        return pong === "PONG";
    } catch {
        return false;
    }
};
