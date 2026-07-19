/**
 * PrepareTurnStart：LangGraph START 后首节点（非 LLM）。
 * 仅挂 ALS 记事本（token 统计 + pipeline_log 队列）；同问短路与 Mem0/LangMem 在后续独立节点。
 */
import { logAgentIn, logAgentOut } from "@fambrain/brain-shared/agent-log";
import {
    createPipelineRunStore,
    pipelineRunStorage,
} from "@fambrain/brain-shared/pipeline-run-context";
import type { PipelineGraphState } from "@/agentflow/pipeline/graph/state";

/** 为本轮绑定 ALS；图内首节点调用一次即可 */
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

    const asOfDate = new Date().toISOString().slice(0, 10);
    logAgentOut("TurnStart", "出去", { alsReady: true, asOfDate });
    return { asOfDate };
};
