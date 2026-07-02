import type { AgentPipelineContext, DbChatTurn } from "@fambrain/agent-types";
import { buildMemoryPromptBlock } from "./build-prompt-block";
import { getMemoryConfig } from "./config";
import { loadSessionSummary, trimHistoryForIntake } from "./langmem";
import { searchUserMemories } from "./mem0";
import type { PipelineMemoryContext } from "./types";
export const preparePipelineMemory = async (input: {
    context: AgentPipelineContext;
    history: DbChatTurn[];
    userQuestion: string;
}): Promise<PipelineMemoryContext> => {
    const cfg = getMemoryConfig();
    const conversationId = input.context.conversationId ?? "";
    const sessionSummary = cfg.langMemEnabled && conversationId
        ? await loadSessionSummary(conversationId)
        : null;
    const userMemories = cfg.mem0Enabled && input.context.actorUserId
        ? await searchUserMemories(input.context.actorUserId, input.userQuestion)
        : [];
    const promptBlock = buildMemoryPromptBlock({ sessionSummary, userMemories });
    const intakeHistory = trimHistoryForIntake(input.history);
    return {
        sessionSummary,
        userMemories,
        promptBlock,
        intakeHistory,
    };
};
