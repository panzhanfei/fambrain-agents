import type {
  AgentPipelineContext,
  AgentPipelineResult,
  AgentStreamEvent,
  DbChatTurn,
} from "@fambrain/agent-types";

import { indexAllCorpora } from "@/agentflow/agents/offline/knowledge-indexer";
import { runPipelineStream } from "@/agentflow/pipeline";

export { indexAllCorpora, runPipelineStream };

/**
 * FamBrain 对话唯一入口：流式产出 step / thinking / assistant，结束时返回终稿 answer。
 */
export function runAgentStream(
  history: DbChatTurn[],
  context: AgentPipelineContext
): AsyncGenerator<AgentStreamEvent, AgentPipelineResult> {
  return runPipelineStream(history, context);
}
