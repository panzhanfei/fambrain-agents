/**
 * PrepareTurnStart：LangGraph START 后第一个在线节点（非 LLM）。
 * 挂 ALS 记事本、同问短路、Mem0/LangMem 上下文注入。
 */
import { logAgentIn, logAgentOut } from "@fambrain/agent-shared/agent-log";
import {
    createPipelineRunStore,
    pipelineRunStorage,
} from "@fambrain/agent-shared/pipeline-run-context";
import { preparePipelineMemory } from "@fambrain/agent-memory";
import type { PipelineGraphState } from "@/agentflow/pipeline/graph/state";
import { findRepeatAnswerInHistory } from "./repeat-question-guard";

/** 为本轮绑定 ALS（token 统计 + pipeline_log 队列）；图内首节点调用一次即可 */
const ensurePipelineRunStore = (): void => {
    if (pipelineRunStorage.getStore()) return;
    pipelineRunStorage.enterWith(createPipelineRunStore());
};

export const runPrepareTurnStart = async (
    state: PipelineGraphState
): Promise<Partial<PipelineGraphState>> => {
    ensurePipelineRunStore();

    logAgentIn("TurnStart", "进入", {
        userQuestion: state.userQuestion,
        historyTurns: state.history.length,
        actorUserId: state.context.actorUserId,
        corpusUserId: state.context.corpusUserId,
        displayName: state.context.displayName,
        conversationId: state.context.conversationId,
    });

    const repeatAnswer = findRepeatAnswerInHistory(
        state.history,
        state.userQuestion
    );
    if (repeatAnswer) {
        logAgentOut("TurnStart", "同问短路", {
            hit: true,
            userQuestion: state.userQuestion,
            answerPreview:
                repeatAnswer.length > 200
                    ? `${repeatAnswer.slice(0, 200)}…`
                    : repeatAnswer,
        });
        logAgentOut("TurnStart", "出去", {
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
    }

    try {
        const memory = await preparePipelineMemory({
            context: state.context,
            history: state.history,
            userQuestion: state.userQuestion,
        });
        logAgentOut("TurnStart", "出去", {
            repeatQuestionHit: false,
            memoryBlockChars: memory.promptBlock?.length ?? 0,
            userMemoryCount: memory.userMemories.length,
            intakeHistoryTurns: memory.intakeHistory.length,
        });
        return {
            memoryBlock: memory.promptBlock,
            intakeHistory: memory.intakeHistory,
            userMemories: memory.userMemories,
        };
    }
    catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        logAgentOut("TurnStart", "出去", { error: message });
        return {
            error: message,
            answer: "（准备对话上下文失败，请稍后重试）",
            exitEarly: true,
        };
    }
};
