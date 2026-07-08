/**
 * LangGraph 记忆注入节点：同问未命中后加载 Mem0 + LangMem，供 Intake / Analyst 使用。
 */
import { logAgentOut } from "@fambrain/brain-shared/agent-log";
import { preparePipelineMemory } from "@fambrain/brain-memory";
import type { PipelineGraphState } from "@/agentflow/pipeline/graph/state";

export const runPreparePipelineMemory = async (
    state: PipelineGraphState
): Promise<Partial<PipelineGraphState>> => {
    try {
        const memory = await preparePipelineMemory({
            context: state.context,
            history: state.history,
            userQuestion: state.userQuestion,
        });
        logAgentOut("PreparePipelineMemory", "出去", {
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
        logAgentOut("PreparePipelineMemory", "出去", { error: message });
        return {
            error: message,
            answer: "（准备对话上下文失败，请稍后重试）",
            exitEarly: true,
        };
    }
};
