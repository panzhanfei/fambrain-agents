import type { PipelineGraphState } from "./state";
import type { IntakeRoutingDecision } from "@/agentflow/brain-service/online/intake-coordinator/contract/prompt";
import { intakeRequiresKmRetrieval } from "@/agentflow/brain-service/online/intake-coordinator/pipeline/intake-km-routing";
import { isUserFactIntent } from "@/agentflow/brain-service/online/user-fact";

/** clarify / 闲聊 / 越界 / direct_answer 等可直接出 briefReply 的路径 */
const shouldRespondEarlyFromIntake = (
    decision: IntakeRoutingDecision
): boolean => {
    if (decision.intent === "clarify" && decision.clarifyingQuestion)
        return true;
    if (
        (decision.intent === "chitchat" || decision.intent === "out_of_scope") &&
        decision.briefReply
    ) {
        return true;
    }
    if (decision.intent === "direct_answer" && decision.briefReply)
        return true;
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
 * Intake 之后的 LangGraph 条件边。
 *
 * 优先级（自上而下，命中即返回）：
 *   1. 异常 / 空 decision → respondEarly
 *   2. userFact（remember/recall，不经 KM）
 *   3. 短答早退（clarify / chitchat / direct_answer + briefReply）
 *   4. KM 检索（retrieve_and_answer；或 summarize 且 searchQuery 非空）
 *   5. 纯摘要（summarize 且无需先查库）
 *   6. 兜底 → factChecker（如 direct_answer 无 briefReply，hits 常空）
 */
export const routeAfterIntake = (
    state: PipelineGraphState
): "respondEarly" | "userFact" | "retrieval" | "dagExecutor" | "factChecker" | "contentSummarizer" => {
    if (state.exitEarly || state.error)
        return "respondEarly";

    const decision = state.decision;
    if (!decision)
        return "respondEarly";

    if (isUserFactIntent(decision.intent))
        return "userFact";

    if (shouldRespondEarlyFromIntake(decision))
        return "respondEarly";

    if (decision.routeMode === "dag" && (decision.executionPlan?.length ?? 0) > 0)
        return "dagExecutor";

    if (intakeRequiresKmRetrieval(decision))
        return "retrieval";

    if (decision.intent === "summarize_content")
        return "contentSummarizer";

    // 兜底：其余 intent 若 LLM 仍给了 briefReply，直接早退
    if (decision.briefReply)
        return "respondEarly";

    return "factChecker";
};

export const routeAfterRetrieval = (
    state: PipelineGraphState
): "factChecker" | "contentSummarizer" => {
    if (state.decision?.intent === "summarize_content") {
        return "contentSummarizer";
    }
    return "factChecker";
};

export const routeAfterFactChecker = (
    state: PipelineGraphState
): "retrieval" | "contentOrganizer" => {
    if (!state.checkerPassed && state.retryCount < 1) {
        return "retrieval";
    }
    return "contentOrganizer";
};
