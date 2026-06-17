import type { QueryProfile } from "./query-profile";

export type { QueryProfile };

/** HY-05：召回通道 */
export type RecallChannel = "vector" | "sparse" | "hybrid";

/** HY-04：Hybrid 主路径 recallSource */
export type RecallSource =
    | "provided"
    | "hybrid"
    | "vector"
    | "sparse"
    | "empty";

/** EV-04：检索置信分档 */
export type ConfidenceTier = "high" | "mid" | "low";

/** HY-05：统一候选（向量 L2 / BM25 rawScore + 可选 fusionScore） */
export type KnowledgeCandidate = {
    path: string;
    title: string;
    body: string;
    /** Chroma L2 距离（越小越好）；sparse-only 无此项 */
    score?: number;
    rawScore?: number;
    recallChannel?: RecallChannel;
    fusionScore?: number;
};

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
    /** EV-04：可选置信分档（向后兼容） */
    confidenceTier?: ConfidenceTier;
    /** EV-01：0–1 综合置信分（日志 / eval 用） */
    confidenceScore?: number;
};
export type KnowledgeManagerInput = {
    corpusUserId: string;
    searchQuery: string;
    topics: string[];
    subTasks: string[];
    /** Intake queryType；缺失时 KM 规则推断（KM-08） */
    queryType?: QueryProfile | null;
    candidates: KnowledgeCandidate[];
};
