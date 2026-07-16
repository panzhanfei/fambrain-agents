import type { AssistantMessageBlock } from "@fambrain/brain-types";
import type { QueryProfile } from "@/agentflow/agents/online/knowledge-manager";
import type { Citation } from "@/agentflow/agents/online/information-analyst/prompt";
import type { KnowledgeHit } from "@/agentflow/agents/online/knowledge-manager";

/** 四类数据源：语料 / 联网 / 确定性计算 / 汇合 */
export type DataSource = "corpus" | "web" | "compute" | "synthesize";

export const TOOL_RUN_IDS = [
    "retrieve_corpus",
    "list_corpus_entries",
    "compute_age_from_hits",
    "compute_tenure_from_hits",
    "extract_identity_from_hits",
    "extract_external_links_from_hits",
    "compose_enumeration",
    "search_web",
    "synthesize_merge",
] as const;

export type ToolRunId = (typeof TOOL_RUN_IDS)[number];

export type ToolRunResult = {
    toolId: ToolRunId;
    label: string;
    ok: boolean;
    answer: string;
    citations: Citation[];
    hits: KnowledgeHit[];
    blocks?: AssistantMessageBlock[];
    insufficientEvidence: boolean;
    confidence: number;
    webSnippets?: Array<{ title: string; url: string; snippet: string }>;
};

export type ExecutionPlanNode = {
    id: string;
    label: string;
    dataSource: DataSource;
    toolId: ToolRunId;
    searchQuery?: string;
    webQuery?: string;
    queryType?: QueryProfile;
    topics?: string[];
    /** identity 字段 id（来自 field-catalog，非用户口语硬编码） */
    field?: string | null;
    deps: string[];
    /** composite 槽位执行时覆盖 state.hits */
    hitsOverride?: KnowledgeHit[];
    /** composite 列举槽的 KM 元数据 */
    enumerationMetaOverride?: import("@/agentflow/agents/online/knowledge-manager").EnumerationMeta | null;
};

export type EnrichedPlanItem = {
    label: string;
    searchQuery: string;
    queryType: QueryProfile;
    topics: string[];
    dataSource: DataSource;
    field: string | null;
    toolId: ToolRunId | null;
};

export type PipelineToolResults = Record<string, ToolRunResult>;
