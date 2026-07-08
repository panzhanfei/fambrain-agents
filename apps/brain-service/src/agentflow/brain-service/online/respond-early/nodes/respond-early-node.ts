import type { PipelineGraphState } from "@/agentflow/pipeline/graph/state";

/** LangGraph respondEarly 节点：Intake 早退（clarify / chitchat / briefReply / 记忆加载失败等） */
export const runRespondEarlyNode = (
    state: PipelineGraphState
): Partial<PipelineGraphState> => {
    if (state.answer) {
        return { exitEarly: true };
    }
    const decision = state.decision;
    if (!decision) {
        return {
            answer: "（未能理解您的问题，请换一种方式描述）",
            exitEarly: true,
        };
    }
    if (decision.intent === "clarify" && decision.clarifyingQuestion) {
        return { answer: decision.clarifyingQuestion, exitEarly: true };
    }
    if (decision.briefReply) {
        return { answer: decision.briefReply, exitEarly: true };
    }
    return {
        answer: "（未能生成回复，请稍后重试）",
        exitEarly: true,
    };
};
