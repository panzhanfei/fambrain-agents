import { buildRateLimitKeyPrefix } from "../config.ts";
import { getRedisClient } from "../redis/client.ts";

/**
 * 滑动窗口限流（Redis INCR + EXPIRE）。
 * Redis 不可用时返回 ok: true（由调用方决定是否 fallback 内存限流）。
 */
export const tryConsumeRedisRateLimit = async (
    key: string,
    limit: number,
    windowMs: number
): Promise<
    | { ok: true; backend: "redis" }
    | { ok: false; retryAfterSec: number; backend: "redis" }
    | { ok: true; backend: "none" }
> => {
    const redis = getRedisClient();
    if (!redis) return { ok: true, backend: "none" };

    const redisKey = `${buildRateLimitKeyPrefix()}:${key}`;
    try {
        if (redis.status !== "ready") await redis.connect();
        const count = await redis.incr(redisKey);
        if (count === 1) {
            await redis.pexpire(redisKey, windowMs);
        }
        if (count > limit) {
            const ttlMs = await redis.pttl(redisKey);
            const retryAfterSec = Math.max(
                1,
                Math.ceil((ttlMs > 0 ? ttlMs : windowMs) / 1000)
            );
            return { ok: false, retryAfterSec, backend: "redis" };
        }
        return { ok: true, backend: "redis" };
    } catch {
        return { ok: true, backend: "none" };
    }
};
