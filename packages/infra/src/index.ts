import { getInfraConfig } from "./config";

export {
    getInfraConfig,
    resolveRedisUrl,
    resetInfraConfigForTests,
    type InfraConfig,
} from "./config";

export const isRepeatQuestionCacheEnabled = (): boolean =>
    getInfraConfig().repeatQuestionCache.enabled;
export {
    getRedisClient,
    createRedisConnection,
    closeRedisClient,
    pingRedis,
    isRedisConfigured,
} from "./redis/client";
export {
    getRetrievalFromCache,
    setRetrievalCache,
    clearMemoryRetrievalCache,
    getRetrievalCacheBackend,
    normalizeSearchQuery,
    buildRetrievalCacheKey,
    type CachedRetrievalPayload,
    type RetrievalCacheBackend,
    type RetrievalCacheKeyParts,
} from "./cache/retrieval-cache";
export {
    getCompositeSession,
    setCompositeSession,
    clearCompositeSession,
    upsertFacetAnswers,
    isFacetAnswerReusable,
    clearMemoryCompositeAnswerCache,
    getCompositeAnswerCacheBackend,
    type CachedFacetAnswer,
    type CompositeSessionSnapshot,
    type CompositeSessionKey,
    type CompositeAnswerCacheBackend,
} from "./cache/composite-answer-cache";
export { tryConsumeRedisRateLimit } from "./rate-limit/redis-rate-limit";
export * from "./queue/index";
