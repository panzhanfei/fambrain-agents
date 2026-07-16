/**
 * @deprecated 图已改用 planExecutor 内嵌 per-step FC。
 * 保留节点实现供旧脚本 / 调试直接调用。
 */
import { runPerStepFactChecks } from "./check-step";
import type { PipelineGraphState } from "@/agentflow/pipeline/graph/state";

const mergeAnalystNotes = (
    kmNotes: string | null,
    checkerNotes: string | null
): string | null => {
    const parts = [kmNotes, checkerNotes].filter(
        (n): n is string => typeof n === "string" && n.trim().length > 0
    );
    return parts.length > 0 ? parts.join(" ") : null;
};

/** LangGraph factChecker 节点（legacy）；composite ≥2 不再 skip */
export const runFactCheckerNode = async (
    state: PipelineGraphState
): Promise<Partial<PipelineGraphState>> => {
    const decision = state.decision;
    if (!decision) {
        return { checkerPassed: true };
    }

    const subs = state.compositeSubResults ?? [];
    if (subs.length === 0) {
        return { checkerPassed: true, notes: state.notes };
    }

    try {
        const fc = await runPerStepFactChecks({
            userQuestion: state.userQuestion,
            decision,
            compositeSubResults: subs,
            retryCount: state.retryCount,
            retrievalCacheHit: state.retrievalCacheHit,
        });
        const patch: Partial<PipelineGraphState> = {
            checkerPassed: fc.checkerPassed,
            notes: mergeAnalystNotes(state.notes, fc.notes),
            stepResults: fc.stepResults,
        };
        if (fc.refinedDecision) {
            patch.decision = fc.refinedDecision;
        }
        return patch;
    } catch (e) {
        const msg = e instanceof Error ? e.message : "事实核查员调用失败";
        return { checkerPassed: true, error: msg };
    }
};
