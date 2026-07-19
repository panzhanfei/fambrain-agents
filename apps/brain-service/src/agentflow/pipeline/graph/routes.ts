import type { PipelineGraphState } from "./state";
import type { IntakeRoutingDecision } from "@/agentflow/agents/online/intake-coordinator/contract/prompt";
import { intakeRequiresKmRetrieval } from "@/agentflow/agents/online/intake-coordinator/pipeline/intake-km-routing";
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
 * Intake 之后：early / userFact 短路；其余进 planExecutor（含 summarize 需先查库）。
 */
export const routeAfterIntake = (
  state: PipelineGraphState
): "respondEarly" | "userFact" | "planExecutor" | "contentSummarizer" => {
  if (state.exitEarly || state.error) return "respondEarly";

  const decision = state.decision;
  if (!decision) return "respondEarly";

  if (isUserFactIntent(decision.intent)) return "userFact";

  if (shouldRespondEarlyFromIntake(decision)) return "respondEarly";

  const pathPlan = decision.pathPlan;
  const hasPathSteps =
    (pathPlan?.km.length ?? 0) +
      (pathPlan?.list.length ?? 0) +
      (pathPlan?.tool.length ?? 0) +
      (pathPlan?.dag.length ?? 0) >
    0;

  if (
    decision.composeMode === "summarize" &&
    !hasPathSteps &&
    !intakeRequiresKmRetrieval(decision)
  ) {
    return "contentSummarizer";
  }

  if (
    hasPathSteps ||
    intakeRequiresKmRetrieval(decision) ||
    decision.routeMode === "dag" ||
    decision.routeMode === "slots" ||
    decision.routeMode === "list"
  ) {
    return "planExecutor";
  }

  if (decision.intent === "summarize_content") return "contentSummarizer";

  if (decision.briefReply) return "respondEarly";

  // 兜底：仍进 planExecutor（空 plan 会报错，优于静默 factChecker）
  return "planExecutor";
};

/** planExecutor 之后按 composeMode 分流 */
export const routeAfterPlanExecutor = (
  state: PipelineGraphState
): "contentSummarizer" | "contentOrganizer" | "respondEarly" => {
  if (state.error) return "respondEarly";
  if (
    state.decision?.composeMode === "summarize" ||
    state.decision?.intent === "summarize_content"
  ) {
    return "contentSummarizer";
  }
  return "contentOrganizer";
};

/** @deprecated 保留导出名供旧脚本；图已不再使用 */
export const routeAfterRetrieval = routeAfterPlanExecutor;

/** @deprecated 图已内嵌 per-step FC */
export const routeAfterFactChecker = (
  _state: PipelineGraphState
): "contentOrganizer" => "contentOrganizer";
