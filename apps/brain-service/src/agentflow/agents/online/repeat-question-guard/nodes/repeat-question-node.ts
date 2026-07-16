/**
 * LangGraph 同问短路节点：字面 normalize 重复问时复用 history assistant 答，跳过 Mem0 / Intake / KM。
 */
import { logAgentOut } from "@fambrain/brain-shared/agent-log";
import type { PipelineGraphState } from "@/agentflow/pipeline/graph/state";
import { findRepeatAnswerInHistory } from "../repeat-question-guard";

export const runRepeatQuestionGuard = async (
    state: PipelineGraphState
): Promise<Partial<PipelineGraphState>> => {
    const repeatAnswer = findRepeatAnswerInHistory(
        state.history,
        state.userQuestion
    );
    if (!repeatAnswer) {
        logAgentOut("RepeatQuestionGuard", "出去", { hit: false });
        return { repeatQuestionHit: false };
    }

    logAgentOut("RepeatQuestionGuard", "同问短路", {
        hit: true,
        userQuestion: state.userQuestion,
        answerPreview:
            repeatAnswer.length > 200
                ? `${repeatAnswer.slice(0, 200)}…`
                : repeatAnswer,
    });
    logAgentOut("RepeatQuestionGuard", "出去", {
        hit: true,
        repeatQuestionHit: true,
        exitEarly: true,
    });
    return {
        answer: repeatAnswer,
        exitEarly: true,
        repeatQuestionHit: true,
        memoryBlock: null,
        userMemories: [],
        intakeHistory: state.history,
    };
};
