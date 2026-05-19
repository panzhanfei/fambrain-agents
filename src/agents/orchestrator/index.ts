import { runPipelineStream } from "@/agents/pipeline";
import type {
  AgentPipelineResult,
  AgentStreamEvent,
  DbChatTurn,
} from "@/agents/types";

export type { AgentPipelineResult, AgentStreamEvent, DbChatTurn };

/**
 * FamBrain 对话唯一入口：流式产出 step / thinking / assistant，结束时返回终稿 answer。
 */
export function runAgentStream(
  history: DbChatTurn[]
): AsyncGenerator<AgentStreamEvent, AgentPipelineResult> {
  return runPipelineStream(history);
}
