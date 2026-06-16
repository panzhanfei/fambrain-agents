/**
 * KnowledgeManager 输入/输出类型（检索合同）。
 * 在线检索不调 LLM，见 retrieve.ts。
 */
export type KnowledgeHit = {
    /** 相对仓库的路径，如 data/doc/users/<userId>/corpus/personal/个人简历.md */
    path: string;
    title: string;
    /** 与查询相关的原文摘录，须来自 candidate 正文，勿编造 */
    excerpt: string;
    /** 0–1，与 searchQuery 的相关度 */
    relevance: number;
};
export type KnowledgeRetrievalResult = {
    hits: KnowledgeHit[];
    coverage: "sufficient" | "partial" | "none";
    notes: string | null;
};
export type KnowledgeManagerInput = {
    corpusUserId: string;
    searchQuery: string;
    topics: string[];
    subTasks: string[];
    candidates: {
        path: string;
        title: string;
        body: string;
    }[];
};
