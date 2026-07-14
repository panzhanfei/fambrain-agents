/**
 * Intake composite（规划侧）类型约定。
 */
import type {
    IntakeRetrievalPlanItem,
    IntakeRoutingDecision,
} from "@/agentflow/brain-service/online/intake-coordinator/contract";

export type CompositeFacetId =
    | "identity"
    | "projects"
    | "employers"
    | "recent";

/** 槽 id：已知 facet（identity/projects…）或 plan-N 动态项 */
export type CompositeSlotId = CompositeFacetId | `plan-${number}` | string;

/** 一个检索槽：并行 KM 时每个 Promise 对应一个 */
export type CompositeRetrievalSlot = {
    id: CompositeSlotId;
    label: string;
    searchQuery: string;
    queryType: NonNullable<IntakeRoutingDecision["queryType"]>;
    topics: string[];
    subTasks: string[];
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
};
