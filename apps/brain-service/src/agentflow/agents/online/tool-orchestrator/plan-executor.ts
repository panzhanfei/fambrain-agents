/**
 * Plan Executor：按 pathPlan 调度 km/list/tool/dag，内嵌 per-step FC。
 */
import { logAgentOut } from "@fambrain/brain-shared/agent-log";
import { emptyPathPlan } from "@/agentflow/agents/online/intake-coordinator/path-plan";
import { runPerStepFactChecks } from "@/agentflow/agents/online/fact-checker/check-step";
import { runRetrievalNode } from "@/agentflow/agents/online/knowledge-manager";
import type { PipelineGraphState } from "@/agentflow/pipeline/graph/state";
import { runDagExecutorNode, runToolOrchestratorNode } from "./nodes";

/**
 * LangGraph `planExecutor` 节点。
 *
 * - hybrid_multi_source / routeMode=dag → executeDagPlan
 * - 其余 → slots retrieval → per-step FC（可局部重试 1 次）→ post-retrieval tools
 */
export const runPlanExecutorNode = async (
    state: PipelineGraphState
): Promise<Partial<PipelineGraphState>> => {
    const decision = state.decision;
    if (!decision) {
        return { error: "缺少入口路由决策" };
    }

    const pathPlan = decision.pathPlan ?? emptyPathPlan();
    const isHybrid =
        pathPlan.dag.some((d) => d.template === "hybrid_multi_source") ||
        (decision.routeMode === "dag" &&
            (decision.executionPlan?.length ?? 0) > 0);

    logAgentOut("PlanExecutor", "进入", {
        composeMode: decision.composeMode,
        km: pathPlan.km.length,
        list: pathPlan.list.length,
        tool: pathPlan.tool.length,
        dag: pathPlan.dag.map((d) => d.template),
        isHybrid,
    });

    if (isHybrid) {
        const dagPatch = await runDagExecutorNode(state);
        if (dagPatch.error) return dagPatch;
        return {
            ...dagPatch,
            stepResults: [
                {
                    stepId: "dag-hybrid",
                    pathKind: "dag" as const,
                    label: "综合评估",
                    hits: dagPatch.hits ?? [],
                    coverage: dagPatch.coverage ?? "none",
                    notes: dagPatch.notes ?? null,
                    fc: { passed: true },
                },
            ],
            checkerPassed: true,
        };
    }

    // 强制 slots 检索（pathPlan 已派生 compositeSlots）
    let working: PipelineGraphState = {
        ...state,
        decision: {
            ...decision,
            routeMode: "slots",
            compositeSlots:
                decision.compositeSlots.length > 0
                    ? decision.compositeSlots
                    : decision.pathPlan
                      ? // fallback already on decision
                        decision.compositeSlots
                      : decision.compositeSlots,
        },
    };

    if (
        !working.decision?.compositeSlots?.length &&
        pathPlan.km.length + pathPlan.list.length + pathPlan.dag.length === 0
    ) {
        return { error: "pathPlan 为空且无 compositeSlots" };
    }

    let retrievalPatch = await runRetrievalNode(working);
    if (retrievalPatch.error) {
        return retrievalPatch;
    }
    working = { ...working, ...retrievalPatch };

    const runFc = async (st: PipelineGraphState) =>
        runPerStepFactChecks({
            userQuestion: st.userQuestion,
            decision: st.decision!,
            compositeSubResults: st.compositeSubResults ?? [],
            retryCount: st.retryCount,
            retrievalCacheHit: st.retrievalCacheHit,
        });

    let fc = await runFc(working);

    if (fc.refinedDecision && working.retryCount < 1) {
        logAgentOut("PlanExecutor", "per-step FC 局部重试", {
            refinedSearchQuery: fc.refinedDecision.searchQuery,
        });
        working = {
            ...working,
            decision: fc.refinedDecision,
            checkerPassed: false,
            retryCount: working.retryCount,
        };
        retrievalPatch = await runRetrievalNode({
            ...working,
            decision: { ...fc.refinedDecision, routeMode: "slots" },
        });
        if (retrievalPatch.error) return retrievalPatch;
        working = {
            ...working,
            ...retrievalPatch,
            retryCount: working.retryCount + 1,
        };
        fc = await runFc(working);
    }

    working = {
        ...working,
        stepResults: fc.stepResults,
        checkerPassed: true,
        notes: [working.notes, fc.notes].filter(Boolean).join(" ") || working.notes,
    };

    const toolPatch = await runToolOrchestratorNode(working);

    logAgentOut("PlanExecutor", "完成", {
        stepCount: fc.stepResults.length,
        toolKeys: Object.keys(toolPatch.toolResults ?? working.toolResults ?? {}),
        coverage: working.coverage,
    });

    return {
        ...working,
        ...toolPatch,
        stepResults: fc.stepResults,
        checkerPassed: true,
    };
};
