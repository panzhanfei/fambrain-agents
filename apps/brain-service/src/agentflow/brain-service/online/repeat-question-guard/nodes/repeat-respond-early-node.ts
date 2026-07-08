import type { PipelineGraphState } from "@/agentflow/pipeline/graph/state";

/**
 * LangGraph 同问短路终态节点：answer 已由 repeatQuestionGuard 写入，此处仅确认早退。
 * 与 intake-coordinator/respondEarly 分离，便于后续独立扩展同问相关策略。
 */
export const runRepeatRespondEarlyNode = (
    state: PipelineGraphState
): Partial<PipelineGraphState> => {
    if (state.answer?.trim()) {
        return { exitEarly: true, repeatQuestionHit: true };
    }
    return {
        answer: "（未能复用历史回答，请稍后重试）",
        exitEarly: true,
        repeatQuestionHit: true,
    };
};
