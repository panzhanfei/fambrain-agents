/**
 * D5-2：检索 cache 单测（memory fallback；Redis 在线时额外测 ping）。
 *
 *   pnpm --filter @fambrain/agents run verify:retrieval-cache
 */
import {
    clearMemoryRetrievalCache,
    getRetrievalCacheBackend,
    getRetrievalFromCache,
    normalizeSearchQuery,
    pingRedis,
    resetInfraConfigForTests,
    setRetrievalCache,
} from "@fambrain/infra";
import { enableMemoryRetrievalCacheForVerify } from "./verify-test-env";

console.log("verify-retrieval-cache\n— normalize —");

{
    const q = normalizeSearchQuery("  城管平台用了什么技术？  ");
    if (q !== "城管平台用了什么技术") {
        console.error(`  ✗ normalize: ${q}`);
        process.exit(1);
    }
    console.log("  ✓ normalizeSearchQuery 去空白与末尾标点");
}

console.log("\n— memory cache —");

enableMemoryRetrievalCacheForVerify();
clearMemoryRetrievalCache();

const key = {
    corpusUserId: "user-a",
    searchQuery: "城管平台用了什么技术",
    queryType: "tech",
};

const payload = {
    hits: [
        {
            path: "data/doc/users/user-a/corpus/projects/城市管理平台.md",
            title: "城市管理平台",
            excerpt: "React",
            relevance: 0.9,
        },
    ],
    coverage: "sufficient" as const,
    notes: null,
};

await setRetrievalCache(key, payload);
const hit = await getRetrievalFromCache(key);
if (!hit || hit.hits.length !== 1) {
    console.error("  ✗ memory set/get");
    process.exit(1);
}
console.log(`  ✓ memory set/get (backend=${getRetrievalCacheBackend()})`);

const miss = await getRetrievalFromCache({
    ...key,
    searchQuery: "完全不同的问题",
});
if (miss) {
    console.error("  ✗ 不同 query 不应命中");
    process.exit(1);
}
console.log("  ✓ 不同 query 不命中");

console.log("\n— Redis（可选）—");

delete process.env.REDIS_ENABLED;
resetInfraConfigForTests();

if (await pingRedis()) {
    console.log("  ✓ Redis PING ok");
} else {
    console.log("  (skip) Redis 未配置或未启动 — Docker 请设 REDIS_URL");
}

console.log("\nOK");
