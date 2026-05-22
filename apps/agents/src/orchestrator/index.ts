import { runPipelineStream } from "../pipeline";
import type {
  AgentPipelineContext,
  AgentPipelineResult,
  AgentStreamEvent,
  DbChatTurn,
} from "@fambrain/agent-types";

/**
 * FamBrain 对话唯一入口：流式产出 step / thinking / assistant，结束时返回终稿 answer。
 */
export function runAgentStream(
  history: DbChatTurn[],
  context: AgentPipelineContext
): AsyncGenerator<AgentStreamEvent, AgentPipelineResult> {
  return runPipelineStream(history, context);
}
