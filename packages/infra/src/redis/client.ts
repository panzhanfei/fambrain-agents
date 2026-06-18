import Redis from "ioredis";
import { getInfraConfig } from "../config.ts";

let client: Redis | null = null;
let clientUrl: string | null = null;

export const isRedisConfigured = (): boolean => {
    return Boolean(getInfraConfig().redisUrl);
};

export const getRedisClient = (): Redis | null => {
    const { redisUrl } = getInfraConfig();
    if (!redisUrl) return null;
    if (client && clientUrl === redisUrl) return client;
    if (client) {
        client.disconnect();
        client = null;
    }
    client = new Redis(redisUrl, {
        maxRetriesPerRequest: null,
        lazyConnect: true,
    });
    clientUrl = redisUrl;
    return client;
};

export const createRedisConnection = (): Redis => {
    const { redisUrl } = getInfraConfig();
    if (!redisUrl) {
        throw new Error("REDIS_URL / REDIS_HOST 未配置，无法创建 Redis 连接");
    }
    return new Redis(redisUrl, {
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
