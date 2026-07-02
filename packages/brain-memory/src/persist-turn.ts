import type { AgentPipelineContext, DbChatTurn } from "@fambrain/agent-types";
import { getMemoryConfig } from "./config";
import { persistSessionSummary } from "./langmem";
import { addTurnToMem0 } from "./mem0";
export const persistPipelineMemory = async (input: {
    context: AgentPipelineContext;
    history: DbChatTurn[];
    userQuestion: string;
    answer: string;
}): Promise<void> => {
    const cfg = getMemoryConfig();
    const trimmed = input.answer.trim();
    if (!trimmed)
        return;
    const tasks: Promise<void>[] = [];
    if (cfg.mem0Enabled && !cfg.learningPipelineEnabled) {
        tasks.push(addTurnToMem0(input.context.actorUserId, input.userQuestion, trimmed));
    }
    if (cfg.langMemEnabled && input.context.conversationId) {
        tasks.push(persistSessionSummary(input.context.conversationId, input.history, trimmed));
    }
    await Promise.all(tasks);
};
