/**
 * PersistTurnEnd：LangGraph END 前最后一个在线节点（非 LLM）。
 * 轮次结束后写 Mem0/LangMem、触发 Learning 候选抽取。
 */
import { logAgentIn, logAgentOut } from "@fambrain/brain-shared/agent-log";
import { persistPipelineMemory } from "@fambrain/brain-memory";
import { persistLearningAfterTurn } from "@/agentflow/agents/offline/learning";
import type { PipelineGraphState } from "@/agentflow/pipeline/graph/state";

const retrievalPathsFromState = (state: PipelineGraphState): string[] => {
    const paths = state.hits
        .map((h) => h.path?.trim())
        .filter((p): p is string => Boolean(p));
    return [...new Set(paths)];
};

export const runPersistTurnEnd = async (
    state: PipelineGraphState
): Promise<Partial<PipelineGraphState>> => {
    logAgentIn("TurnEnd", "进入", {
        userQuestion: state.userQuestion,
        repeatQuestionHit: state.repeatQuestionHit,
        hasAnswer: Boolean(state.answer?.trim()),
        userFact: Boolean(state.decision?.userFact),
    });

    if (state.repeatQuestionHit) {
        logAgentOut("TurnEnd", "出去", { skipped: true, reason: "repeat_question_hit" });
        return {};
    }

    const answer = state.answer?.trim();
    if (!answer) {
        logAgentOut("TurnEnd", "出去", { skipped: true, reason: "empty_answer" });
        return {};
    }

    try {
        await persistPipelineMemory({
            context: state.context,
            history: state.history,
            userQuestion: state.userQuestion,
            answer,
        });

        let learningRan = false;
        if (!state.decision?.userFact) {
            await persistLearningAfterTurn({
                context: state.context,
                userQuestion: state.userQuestion,
                answer,
                retrievalPaths: retrievalPathsFromState(state),
            });
            learningRan = true;
        }

        logAgentOut("TurnEnd", "出去", {
            mem0LangMem: true,
            learningRan,
            retrievalPathCount: retrievalPathsFromState(state).length,
        });
        return {};
    }
    catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        logAgentOut("TurnEnd", "出去", { error: message });
        return {};
    }
};
