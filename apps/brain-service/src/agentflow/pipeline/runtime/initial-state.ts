import type { AgentPipelineContext, DbChatTurn } from "@fambrain/brain-types";
import type { PipelineGraphState } from "../graph/state";

/** 从 history 末尾向前取最后一条 user 消息，作为本轮 userQuestion */
export const lastUserQuestion = (history: DbChatTurn[]): string => {
    for (let i = history.length - 1; i >= 0; i--) {
        if (history[i].role === "user") return history[i].content.trim();
    }
    return "";
};

/** 构造 LangGraph 初始状态；memory 字段由 prepareTurnStart 节点填充 */
export const buildInitialState = (
    history: DbChatTurn[],
    context: AgentPipelineContext,
    userQuestion: string
): PipelineGraphState => {
    return {
        history,
        context,
        userQuestion,
        decision: null,
        hits: [],
        coverage: "none",
        notes: null,
        answer: null,
        assistantBlocks: null,
        error: null,
        exitEarly: false,
        checkerPassed: true,
        retryCount: 0,
        memoryBlock: null,
        userMemories: [],
        intakeHistory: history,
        confidenceTier: null,
        enumerationMeta: null,
        repeatQuestionHit: false,
        retrievalCacheHit: false,
        retrievalCacheSlotHits: null,
        compositeSubResults: null,
        compositeIncrementalPlan: null,
        compositeFacetCacheHits: null,
        asOfDate: new Date().toISOString().slice(0, 10),
        toolResults: null,
    };
};
