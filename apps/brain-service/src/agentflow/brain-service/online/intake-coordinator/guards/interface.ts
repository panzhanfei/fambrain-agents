/**
 * Intake guards 类型约定。
 * routeMode：skip | slots | list | dag
 */
import type {
    CompositeRetrievalSlot,
    CompositeRoutePlanSource,
} from "@/agentflow/brain-service/online/intake-coordinator/composite/interface";
import type { IntakeRoutingDecision } from "@/agentflow/brain-service/online/intake-coordinator/contract";
import type { UserFactRoute } from "@/agentflow/brain-service/online/user-fact";
import type {
    EnrichedPlanItem,
    ExecutionPlanNode,
} from "@/agentflow/tool-orchestration/types";

export type IntakeRouteMode = "skip" | "slots" | "list" | "dag";

/** 为何走到当前 routeMode（写进日志 routeReason） */
export type CompositeRouteReason =
    | "skip_non_retrieve"
    | "intake_retrieval_plan"
    | "intake_subtasks_fallback"
    | "structural_multipart_fallback"
    | "query_type_template"
    | "slots_default";

export type EnumerationListIntent = "preview" | "continue" | "exhaustive";

export type IntakeRetrievalPlanGuardReason =
    | "noop"
    | "filled_fallback"
    | "canonicalized";

/**
 * Intake 编排工单（写入 state.decision）。
 * 比 LLM 原始 JSON 多：routeMode、compositeSlots、列举分页、工具计划等。
 */
export type RoutedIntakeDecision = IntakeRoutingDecision & {
    routeMode: IntakeRouteMode;
    /** 完整槽对象数组；slots 路由时 length ≥ 1 */
    compositeSlots: CompositeRetrievalSlot[];
    routeReason?: CompositeRouteReason;
    routePlanSource?: CompositeRoutePlanSource;
    /** 用户自述联系方式 remember/recall，不经 KM */
    userFact?: UserFactRoute | null;
    /** preview=首屏；exhaustive=穷举；continue=续页「更多」 */
    listIntent?: EnumerationListIntent | null;
    enumerationPage?: number;
    enumerationPageSize?: number;
    enumerationListKind?: "project" | "experience";
    /** 混合 DAG：Intake 规划，DagExecutor 执行 */
    executionPlan?: ExecutionPlanNode[];
    enrichedPlan?: EnrichedPlanItem[];
    primaryDataSource?: "corpus" | "web";
    webQuery?: string;
};
