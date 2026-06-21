import { getInfraConfig } from "../config";

/** 检索 cache key 组成部分 */
export type RetrievalCacheKeyParts = {
    corpusUserId: string;
    searchQuery: string;
    queryType: string;
};

/** 归一化 searchQuery，提高同句再问命中率 */
export const normalizeSearchQuery = (searchQuery: string): string => {
    return searchQuery
        .trim()
        .replace(/\s+/g, " ")
        .replace(/[？?！!。．]+$/u, "")
        .toLowerCase();
};

export const buildRetrievalCacheKey = (
    parts: RetrievalCacheKeyParts
): string => {
    const prefix = getInfraConfig().retrievalCache.keyPrefix;
    const q = normalizeSearchQuery(parts.searchQuery);
    const qt = parts.queryType.trim() || "default";
    return `${prefix}:${parts.corpusUserId}:${qt}:${q}`;
};
