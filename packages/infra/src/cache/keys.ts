const PREFIX = "fambrain:retrieval:v1";

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
    const q = normalizeSearchQuery(parts.searchQuery);
    const qt = parts.queryType.trim() || "default";
    return `${PREFIX}:${parts.corpusUserId}:${qt}:${q}`;
};
