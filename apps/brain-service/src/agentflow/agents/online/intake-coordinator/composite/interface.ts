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

export type CompositeFacetId =
    | "identity"
    | "projects"
    | "employers"
    | "recent";

/** 槽 id：已知 facet（identity/projects…）或 plan-N 动态项 */
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

export type CompositeRoutePlanSource =
    | "intake_retrieval_plan"
    | "intake_subtasks"
    | "structural_multipart"
    | "query_type_template"
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
