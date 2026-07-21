/**
 * Intake composite（规划侧）类型约定。
 */
import type {
    IntakeRetrievalPlanItem,
    IntakeRoutingDecision,
} from "@/agentflow/agents/online/intake-coordinator/contract";
import type {
    EnumerationControl,
    SlotExecutor,
} from "../enumeration";
import type { IntakeIdentityField } from "@/agentflow/agents/online/intake-coordinator/contract";

/** 已知 canonical facet（槽 id 前缀；动态槽为 `${facet}-${index}`） */
export type CompositeFacetId = "identity" | "projects" | "employers";

/** 槽 id：已知 facet、plan-N，或 `${facet}-${index}` / external_link-* */
export type CompositeSlotId = CompositeFacetId | `plan-${number}` | string;

/** 一个执行槽：KM 语义检索或 list 目录分页（可混搭） */
export type CompositeRetrievalSlot = {
    id: CompositeSlotId;
    label: string;
    searchQuery: string;
    queryType: NonNullable<IntakeRoutingDecision["queryType"]>;
    topics: string[];
    subTasks: string[];
    /** 默认 km_retrieve；continue/exhaustive 列举 → list_corpus */
    executor?: SlotExecutor;
    enumerationControl?: EnumerationControl | null;
    identityField?: IntakeIdentityField | null;
    enumerationPage?: number;
    enumerationPageSize?: number;
};

/** 槽从何而来（档 B：仅 LLM plan / none） */
export type CompositeRoutePlanSource =
    | "intake_retrieval_plan"
    | "none";

export type ResolvedCompositeRoute = {
    slots: CompositeRetrievalSlot[];
    source: CompositeRoutePlanSource;
};

export type EnumerationTarget = "project" | "experience";

export type EnumerationTargetInput = Pick<
    IntakeRetrievalPlanItem,
    "label" | "searchQuery" | "topics"
> & {
    subTasks?: string[];
    /** 优先于 topics：来自 enumerationControl.listKind */
    listKind?: "project" | "experience" | null;
};
