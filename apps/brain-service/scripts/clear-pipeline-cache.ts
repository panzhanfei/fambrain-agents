/**
 * 清空 Pipeline cache（同问短路 / 检索结果 / composite 终稿 cache 均可在 .env 用 DISABLED=1 关闭）。
 *
 *   pnpm --filter @fambrain/brain-service exec tsx --env-file=../../.env scripts/clear-pipeline-cache.ts
 *   CONVERSATION_ID=xxx CORPUS_USER_ID=yyy ...  # 可选，仅清该会话 L3
 *
 * Env 开关：
 *   REPEAT_QUESTION_CACHE_DISABLED=1   — 同问短路（需重启 agents）
 *   RETRIEVAL_CACHE_DISABLED=1         — L2 检索 cache
 *   COMPOSITE_ANSWER_CACHE_DISABLED=1  — L3 composite facet cache
 */
import {
    clearCompositeSession,
    clearMemoryCompositeAnswerCache,
    clearMemoryRetrievalCache,
    closeRedisClient,
    getInfraConfig,
    getRedisClient,
    pingRedis,
} from "@fambrain/infra";

const conversationId = process.env.CONVERSATION_ID?.trim();
const corpusUserId = process.env.CORPUS_USER_ID?.trim();

const flushRedisByPattern = async (pattern: string): Promise<number> => {
    const redis = getRedisClient();
    if (!redis) return 0;
    if (redis.status !== "ready") await redis.connect();
    let cursor = "0";
    let deleted = 0;
    do {
        const [next, keys] = await redis.scan(
            cursor,
            "MATCH",
            pattern,
            "COUNT",
            200
        );
        cursor = next;
        if (keys.length > 0) {
            deleted += await redis.del(...keys);
        }
    } while (cursor !== "0");
    return deleted;
};

const main = async () => {
    clearMemoryRetrievalCache();
    clearMemoryCompositeAnswerCache();

    const cfg = getInfraConfig();
    if (cfg.redisUrl) {
        const ok = await pingRedis();
        console.log(
            `  Redis: ${cfg.redisUrl} db=${cfg.redisDb} ping=${ok ? "OK" : "FAIL"}`
        );
        if (!ok) {
            console.log(
                "  ⚠ Redis 不可达，仅清除了本脚本进程 memory；agents 进程内 cache 需重启服务。"
            );
        }
    } else {
        console.log("  Redis: 未配置（REDIS_ENABLED=0 / 无 REDIS_URL）→ 仅用 memory");
    }

    if (conversationId && corpusUserId) {
        await clearCompositeSession({
            conversationId,
            corpusUserId,
        });
        console.log(
            `  ✓ L3 session cleared: ${conversationId} / ${corpusUserId}`
        );
    }

    const l2Before = await flushRedisByPattern(`${cfg.retrievalCache.keyPrefix}:*`);
    const l3Before = await flushRedisByPattern(
        `${cfg.compositeAnswerCache.keyPrefix}:*`
    );

    await closeRedisClient().catch(() => undefined);

    console.log("clear-pipeline-cache OK");
    console.log(`  L2 retrieval keys deleted (redis): ${l2Before}`);
    console.log(`  L3 composite keys deleted (redis): ${l3Before}`);
    if (l2Before === 0 && l3Before === 0 && cfg.redisUrl) {
        console.log(
            "  （Redis 中本就没有 fambrain cache key，可能已 TTL 过期，或 agents 在用进程 memory 未写 Redis）"
        );
    }
    console.log(
        "  进程内 memory cache：请重启 agents 服务（pnpm --filter @fambrain/brain-service dev）"
    );
};

await main();
