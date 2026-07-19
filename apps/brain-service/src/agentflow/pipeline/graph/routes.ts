import type { PipelineGraphState } from "./state";
import type { IntakeRoutingDecision } from "@/agentflow/agents/online/intake-coordinator/contract/prompt";
import { intakeRequiresKmRetrieval } from "@/agentflow/agents/online/intake-coordinator/pipeline/intake-km-routing";
import { isPureSummarizeDecision } from "@/agentflow/agents/online/content-summarizer/summarize-route";
import { isPureListDecision } from "@/agentflow/agents/online/corpus-lister/pure-list-route";
import { isUserFactIntent } from "@/agentflow/agents/online/user-fact";

/** clarify / 闲聊 / 越界 / direct_answer 等可直接出 briefReply 的路径 */
const shouldRespondEarlyFromIntake = (
  decision: IntakeRoutingDecision
): boolean => {
  if (decision.intent === "clarify" && decision.clarifyingQuestion) return true;
  if (
    (decision.intent === "chitchat" || decision.intent === "out_of_scope") &&
    decision.briefReply
  ) {
    return true;
  }
  if (decision.intent === "direct_answer" && decision.briefReply) return true;
  return false;
};

export const routeAfterRepeat = (
  state: PipelineGraphState
): "repeatRespondEarly" | "preparePipelineMemory" => {
  if (state.repeatQuestionHit) return "repeatRespondEarly";
  return "preparePipelineMemory";
};

export const routeAfterPrepareMemory = (
  state: PipelineGraphState
): "respondEarly" | "intake" => {
  if (state.exitEarly || state.error) return "respondEarly";
  return "intake";
};

/**
 * Intake 之后：early / userFact / 纯 list 短路；复合与 km 进 planExecutor。
 */
export const routeAfterIntake = (
  state: PipelineGraphState
):
  | "respondEarly"
  | "userFact"
  | "listRetriever"
  | "planExecutor"
  | "contentSummarizer" => {
  const decision = state?.decision;
  const pathPlan = decision?.pathPlan;
  const hasPathSteps =
    (pathPlan?.km.length ?? 0) +
      (pathPlan?.list.length ?? 0) +
      (pathPlan?.tool.length ?? 0) +
      (pathPlan?.dag.length ?? 0) >
    0;

  if (
    state.exitEarly ||
    state.error ||
    !decision ||
    shouldRespondEarlyFromIntake(decision) ||
    decision.briefReply
  )
    return "respondEarly";

  if (isUserFactIntent(decision.intent)) return "userFact";

  if (isPureSummarizeDecision(decision)) return "contentSummarizer";

  if (isPureListDecision(decision)) return "listRetriever";

  if (
    hasPathSteps ||
    intakeRequiresKmRetrieval(decision) ||
    decision.routeMode === "dag" ||
    decision.routeMode === "slots"
  ) {
    return "planExecutor";
  }

  // 兜底：仍进 planExecutor（空 plan 会报错，优于静默 factChecker）
  return "planExecutor";
};

/** planExecutor 之后统一进入 contentOrganizer → contentSummarizer */
export const routeAfterPlanExecutor = (
  state: PipelineGraphState
): "contentOrganizer" | "respondEarly" => {
  if (state.error) return "respondEarly";
  return "contentOrganizer";
};

/** contentSummarizer 之后：终态摘要 → respondEarly；qa/composite → analyst */
export const routeAfterContentSummarizer = (
  state: PipelineGraphState
): "respondEarly" | "analyst" => {
  if (state.error || state.exitEarly) return "respondEarly";
  return "analyst";
};

/** @deprecated 保留导出名供旧脚本；图已不再使用 */
export const routeAfterRetrieval = routeAfterPlanExecutor;

/** @deprecated 图已内嵌 per-step FC */
export const routeAfterFactChecker = (
  _state: PipelineGraphState
): "contentOrganizer" => "contentOrganizer";
