import { completeIntakeCoordinator } from "../llm/ollama-chat";
import { resolveEnumerationContinuation } from "../guards/enumeration-list-intent";
import { runIntakePipeline } from "../pipeline/intake-pipeline";
import type { PipelineGraphState } from "@/agentflow/pipeline/graph/state";

/** LangGraph intake 节点：列举续问短路 + LLM 路由 + guard pipeline */
export const runIntakeNode = async (
    state: PipelineGraphState
): Promise<Partial<PipelineGraphState>> => {
    try {
        const continued = await resolveEnumerationContinuation({
            userQuestion: state.userQuestion,
            session: {
                conversationId: state.context.conversationId,
                corpusUserId: state.context.corpusUserId,
            },
        });
        if (continued) {
            return { decision: continued };
        }

        const intakeRaw = await completeIntakeCoordinator(state.intakeHistory, {
            memoryBlock: state.memoryBlock,
            intakeHistory: state.intakeHistory,
        });
        const { decision } = runIntakePipeline({
            intakeRaw,
            userQuestion: state.userQuestion,
            intakeHistory: state.intakeHistory,
        });
        return { decision };
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : "入口接线员调用失败，请确认 Ollama 可用";
        return {
            error: msg,
            answer: "（模型调用失败：请确认本地 Ollama 已启动且模型已拉取）",
            exitEarly: true,
        };
    }
};
