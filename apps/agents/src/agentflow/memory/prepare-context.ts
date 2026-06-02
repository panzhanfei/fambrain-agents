import type { AgentPipelineContext, DbChatTurn } from "@fambrain/agent-types";

import { buildMemoryPromptBlock } from "./build-prompt-block";
import { getMemoryConfig } from "./config";
import { loadSessionSummary, trimHistoryForIntake } from "./langmem-session";
import { searchUserMemories } from "./mem0-store";
import type { PipelineMemoryContext } from "./types";

/** 每轮 pipeline 开始前：加载 Mem0 + LangMem，供 Intake / Analyst 注入 */
export async function preparePipelineMemory(input: {
  context: AgentPipelineContext;
  history: DbChatTurn[];
  userQuestion: string;
}): Promise<PipelineMemoryContext> {
  const cfg = getMemoryConfig();
  const conversationId = input.context.conversationId ?? "";

  const sessionSummary =
    cfg.langMemEnabled && conversationId
      ? await loadSessionSummary(conversationId)
      : null;

  const userMemories =
    cfg.mem0Enabled && input.context.actorUserId
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
}
