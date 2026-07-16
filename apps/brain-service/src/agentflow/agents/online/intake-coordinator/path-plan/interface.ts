/**
 * PathPlan：Intake 四桶执行计划（km / list / tool / dag）。
 */
import type { IntakeIdentityField } from "@/agentflow/agents/online/intake-coordinator/contract";
import type { EnumerationControl } from "@/agentflow/agents/online/intake-coordinator/enumeration";
import type {
    ConfidenceTier,
    EnumerationMeta,
    KnowledgeHit,
    KnowledgeRetrievalResult,
} from "@/agentflow/agents/online/knowledge-manager";
import type { FactCheckerIssue } from "@/agentflow/agents/online/fact-checker";
import type { ToolRunResult } from "@/agentflow/agents/online/tool-orchestrator";

export type PathKind = "km" | "list" | "tool" | "dag";

export type ComposeMode = "qa" | "summarize" | "composite";

/** 仅通用多源汇合；禁止为单业务场景再加 named template */
export type DagTemplateId = "hybrid_multi_source";

export type PathStepBase = {
    id: string;
    label: string;
    searchQuery: string;
    queryType: "identity" | "enumeration" | "tech" | "external_link" | "default";
    topics: string[];
    identityField?: IntakeIdentityField | null;
};

export type KmStep = PathStepBase & {
    pathKind: "km";
};

export type ListStep = PathStepBase & {
    pathKind: "list";
    enumerationControl?: EnumerationControl | null;
    enumerationPage?: number;
    enumerationPageSize?: number;
};

export type ToolStep = PathStepBase & {
    pathKind: "tool";
    toolId:
        | "search_web"
        | "compute_age_from_hits"
        | "compose_enumeration"
        | "retrieve_corpus";
    dataSource: "web" | "compute" | "corpus";
};

export type DagRun = {
    id: string;
    pathKind: "dag";
    label: string;
    template: DagTemplateId;
    /** 复用 pathPlan 内其它 step 的结果（如 list-0） */
    deps?: string[];
    params?: Record<string, unknown>;
};

export type PathPlan = {
    km: KmStep[];
    list: ListStep[];
    tool: ToolStep[];
    dag: DagRun[];
};

export type StepFactCheck = {
    passed: boolean;
    refinedSearchQuery?: string | null;
    issues?: FactCheckerIssue[];
    checkerNotes?: string | null;
};

export type StepResult = {
    stepId: string;
    pathKind: PathKind;
    label: string;
    hits: KnowledgeHit[];
    coverage: KnowledgeRetrievalResult["coverage"];
    notes: string | null;
    confidenceTier?: ConfidenceTier | null;
    enumerationMeta?: EnumerationMeta | null;
    toolOutput?: ToolRunResult | null;
    cacheHit?: boolean;
    facetKey?: string;
    fc: StepFactCheck;
};
