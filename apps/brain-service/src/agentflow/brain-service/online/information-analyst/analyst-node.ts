import { getWriter } from "@langchain/langgraph";
import type { LangGraphRunnableConfig } from "@langchain/langgraph";
import { streamAnalyzeInformation } from "./stream";
import type { PipelineGraphState } from "@/agentflow/pipeline/graph/state";

/** LangGraph analyst 节点（经 custom 通道流式推送） */
export const runAnalystNode = async (
    state: PipelineGraphState,
    config: LangGraphRunnableConfig
): Promise<Partial<PipelineGraphState>> => {
    const decision = state.decision;
    if (!decision) {
        return { answer: "（未能理解您的问题，请换一种方式描述）" };
    }
    const write = getWriter(config);
    try {
        const gen = streamAnalyzeInformation({
            userQuestion: state.userQuestion,
            language: decision.language,
            subTasks: decision.subTasks,
            hits: state.hits,
            coverage: state.coverage,
            notes: state.notes,
            memoryBlock: state.memoryBlock,
            routeMode: decision.routeMode ?? "single",
            queryType: decision.queryType,
            searchQuery: decision.searchQuery,
            topics: decision.topics,
            enumerationMeta: state.enumerationMeta ?? null,
            listIntent: decision.listIntent ?? null,
            compositeSubResults: state.compositeSubResults ?? undefined,
            compositeIncrementalPlan:
                state.compositeIncrementalPlan ?? undefined,
            asOfDate: state.asOfDate,
            toolResults: state.toolResults,
            sessionKey: {
                conversationId: state.context.conversationId,
                corpusUserId: state.context.corpusUserId,
            },
        });
        let result = await gen.next();
        while (!result.done) {
            write?.(result.value);
            result = await gen.next();
        }
        return { answer: result.value.answer, assistantBlocks: result.value.blocks ?? [] };
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : "信息分析师调用失败";
        const answer = "（生成回答时出错，请稍后重试）";
        write?.({ type: "assistant", text: answer });
        return { error: msg, answer };
    }
};
