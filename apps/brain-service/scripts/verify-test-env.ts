import { resetInfraConfigForTests } from "@fambrain/infra";

/** verify 脚本内覆盖 .env：开启同问短路（D5-2） */
export const enableRepeatGuardForVerify = (): void => {
    process.env.REPEAT_QUESTION_CACHE_DISABLED = "0";
    resetInfraConfigForTests();
};

/** verify 脚本内覆盖 .env：检索 hits 缓存走 memory fallback 且启用 cache */
export const enableMemoryRetrievalCacheForVerify = (): void => {
    process.env.REDIS_ENABLED = "0";
    delete process.env.REDIS_URL;
    process.env.RETRIEVAL_CACHE_DISABLED = "0";
    resetInfraConfigForTests();
};
