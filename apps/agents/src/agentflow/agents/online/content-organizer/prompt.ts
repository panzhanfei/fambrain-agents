import type { KnowledgeHit, KnowledgeRetrievalResult, } from "@/agentflow/agents/online/knowledge-manager";
import type { QueryProfile } from "@/agentflow/agents/online/knowledge-manager/query-profile";
import { getProfileRecallParams } from "@/agentflow/agents/online/knowledge-manager/km-config";
/**
 * ContentOrganizer 输入：FactChecker 之后的证据包。
 * 职责：按 path 去重 hits、合并 excerpt、统一字段；不调用 LLM。
 */
export type ContentOrganizerInput = {
    hits: KnowledgeHit[];
    coverage: KnowledgeRetrievalResult["coverage"];
    notes: string | null;
    /** 按 queryProfile 限制合并后 hits 上限（默认 default=5） */
    queryProfile?: QueryProfile;
};
export type ContentOrganizerResult = {
    hits: KnowledgeHit[];
    coverage: KnowledgeRetrievalResult["coverage"];
    notes: string | null;
    /** 合并前条数 − 合并后条数（仅统计 path 去重） */
    dedupedCount: number;
};
