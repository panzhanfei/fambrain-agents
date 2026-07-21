/**
 * Intake guards 类型约定。
 * routeMode：skip | slots | list | dag（兼容派生；执行以 pathPlan 为准）
 */
import type {
  CompositeRetrievalSlot,
  CompositeRoutePlanSource,
} from "@/agentflow/agents/online/intake-coordinator/composite/interface";
import type { IntakeRoutingDecision } from "@/agentflow/agents/online/intake-coordinator/contract";
import type {
  ComposeMode,
  PathPlan,
} from "@/agentflow/agents/online/intake-coordinator/path-plan/interface";
import type { UserFactRoute } from "@/agentflow/agents/online/user-fact";
import type {
  EnrichedPlanItem,
  ExecutionPlanNode,
} from "@/agentflow/agents/online/tool-orchestrator";

/** list 已废弃：列举分页改为 slots 内 per-slot executor=list_corpus */
export type IntakeRouteMode = "skip" | "slots" | "list" | "dag";

/** 为何走到当前 routeMode（写进日志 routeReason） */
export type CompositeRouteReason =
  | "skip_non_retrieve"
  | "intake_path_plan"
  | "intake_retrieval_plan";

export type EnumerationListIntent = "preview" | "continue" | "exhaustive";

export type IntakeRetrievalPlanGuardReason =
  | "noop"
  | "repaired_plan"
  | "canonicalized";

/**
 * Intake 编排工单（写入 state.decision）。
 * 主契约：pathPlan + answerOrder + composeMode；compositeSlots 由 pathPlan 派生。
 */
export type RoutedIntakeDecision = IntakeRoutingDecision & {
  routeMode: IntakeRouteMode;
  /** 完整槽对象数组；slots 路由时 length ≥ 1 */
  compositeSlots: CompositeRetrievalSlot[];
  /** 四桶执行计划（km / list / tool / dag）；LLM 产出，代码合法化 */
  pathPlan: PathPlan;
  /** 回答顺序（step id）；与 pathPlan 对齐 */
  answerOrder: string[];
  /** 出稿模式：qa | summarize | composite */
  composeMode: ComposeMode;
  routeReason?: CompositeRouteReason;
  routePlanSource?: CompositeRoutePlanSource;
  /** 用户自述联系方式 remember/recall，不经 KM */
  userFact?: UserFactRoute | null;
  /** preview=首屏；exhaustive=穷举；continue=续页「更多」 */
  listIntent?: EnumerationListIntent | null;
  enumerationPage?: number;
  enumerationPageSize?: number;
  enumerationListKind?: "project" | "experience";
  /** 混合 DAG：planExecutor 内执行 */
  executionPlan?: ExecutionPlanNode[];
  /** retrievalPlan 平行 enrich（toolId/dataSource）；槽级以 compositeSlots 上挂载为准 */
  enrichedPlan?: EnrichedPlanItem[];
};
