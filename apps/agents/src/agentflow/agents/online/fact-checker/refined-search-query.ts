import type { FactCheckerInput } from "./prompt";

/** FC / LLM 常输出的「怎么查」指令词，不是语料检索词 */
const META_REFINED_TOKENS = new Set([
    "全名",
    "完整",
    "完整称呼",
    "称呼",
    "查询",
    "检索",
    "检索词",
    "更具体",
    "更完整",
    "实体",
    "关键词",
    "搜索",
]);

const splitQueryTokens = (query: string): string[] => {
    return [...new Set(query.trim().split(/\s+/).filter(Boolean))];
};

const normalizeHitPath = (path: string): string => path.replace(/\\/g, "/");

/** personal 语料或简历类 hit（兼容 LLM 精排缩写 path、仅文件名等） */
export const hasPersonalCorpusHits = (hits: FactCheckerInput["hits"]): boolean => {
    return hits.some((h) => {
        const p = normalizeHitPath(h.path);
        const title = h.title ?? "";
        return (
            /(?:^|[/])personal[/]/i.test(p)
            || /个人简历/i.test(p)
            || /个人简历/i.test(title)
            || /^personal[/]/i.test(p)
        );
    });
};

/** experience/ 任职条目（列举公司问法 KM-13） */
export const hasExperienceCorpusHits = (hits: FactCheckerInput["hits"]): boolean => {
    return hits.some((h) => /(?:^|[/])experience[/]/i.test(normalizeHitPath(h.path)));
};

export const stripMetaFromSearchQuery = (query: string): string => {
    const kept = splitQueryTokens(query).filter((t) => !META_REFINED_TOKENS.has(t));
    return kept.join(" ");
};

/**
 * 合并首轮 searchQuery 与 LLM refined（先去 meta），仅当相对首轮有新增 token 时才建议重检 KM。
 */
export const mergeRetrySearchQuery = (
    input: Pick<FactCheckerInput, "searchQuery" | "userQuestion" | "subTasks" | "topics">,
    llmRefined: string
): { query: string; shouldRetry: boolean; skipReason: string | null } => {
    const original = input.searchQuery.trim();
    const strippedRefined = stripMetaFromSearchQuery(llmRefined);
    // 仅合并首轮 searchQuery + strip 后 refined（不把 userQuestion 当检索词，避免误判「有增量」）
    const parts = [
        original,
        strippedRefined,
        ...input.subTasks,
    ].filter(Boolean);

    const mergedTokens = [...new Set(parts.join(" ").split(/\s+/).filter(Boolean))];
    const originalTokenSet = new Set(splitQueryTokens(original));
    const hasNewTokens = mergedTokens.some((t) => !originalTokenSet.has(t));
    const query = mergedTokens.join(" ").slice(0, 240) || original;

    if (!hasNewTokens || query.trim() === original) {
        return {
            query: original,
            shouldRetry: false,
            skipReason: "refined_merge_no_increment",
        };
    }

    return {
        query,
        shouldRetry: true,
        skipReason: null,
    };
};
