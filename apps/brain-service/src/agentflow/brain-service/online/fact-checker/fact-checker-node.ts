import { completeFactCheck } from "./check-facts";
import type { PipelineGraphState } from "@/agentflow/pipeline/graph/state";

const mergeAnalystNotes = (kmNotes: string | null, checkerNotes: string | null): string | null => {
    const parts = [kmNotes, checkerNotes].filter((n): n is string => typeof n === "string" && n.trim().length > 0);
    return parts.length > 0 ? parts.join(" ") : null;
};

/** LangGraph factChecker 节点 */
export const runFactCheckerNode = async (
    state: PipelineGraphState
): Promise<Partial<PipelineGraphState>> => {
    const decision = state.decision;
    if (!decision) {
        return { checkerPassed: true };
    }
    const slotCount = state.compositeSubResults?.length ?? 0;
    if (slotCount >= 2) {
        return {
            checkerPassed: true,
            notes: state.notes,
        };
    }
    try {
        const result = await completeFactCheck({
            userQuestion: state.userQuestion,
            intent: decision.intent,
            searchQuery: decision.searchQuery || state.userQuestion,
            subTasks: decision.subTasks,
            topics: decision.topics,
            language: decision.language,
            hits: state.hits,
            coverage: state.coverage,
            notes: state.notes,
            retryCount: state.retryCount,
            confidenceTier: state.confidenceTier,
            retrievalCacheHit: state.retrievalCacheHit,
            queryType: decision.queryType,
        });
        const patch: Partial<PipelineGraphState> = {
            checkerPassed: result.passed,
            notes: mergeAnalystNotes(state.notes, result.checkerNotes),
        };
        if (
            !result.passed &&
            result.refinedSearchQuery &&
            state.retryCount < 1 &&
            slotCount <= 1
        ) {
            const primarySlot = decision.compositeSlots[0];
            patch.decision = {
                ...decision,
                searchQuery: result.refinedSearchQuery,
                compositeSlots:
                    primarySlot != null
                        ? [
                              {
                                  ...primarySlot,
                                  searchQuery: result.refinedSearchQuery,
                              },
                          ]
                        : decision.compositeSlots,
            };
        }
        return patch;
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : "事实核查员调用失败";
        return { checkerPassed: true, error: msg };
    }
};
