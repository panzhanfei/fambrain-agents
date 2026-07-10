import { logAgentOut } from "@fambrain/brain-shared/agent-log";
import type { PipelineGraphState } from "@/agentflow/pipeline/graph/state";
import {
    executeDagPlan,
    resolvePostRetrievalToolRuns,
    runExecutionPlanNode,
} from "./execute-tools";
import type { PipelineToolResults } from "./types";

export const runDagExecutorNode = async (
    state: PipelineGraphState
): Promise<Partial<PipelineGraphState>> => {
    const plan = state.decision?.executionPlan;
    if (!plan?.length) {
        return { error: "DAG 路由缺少 executionPlan" };
    }
    try {
        const toolResults = await executeDagPlan(plan, state);
        const resume = toolResults.resume;
        const synthesis = toolResults.synthesis;
        return {
            hits: resume?.hits ?? [],
            coverage:
                resume && resume.hits.length > 0
                    ? resume.insufficientEvidence
                        ? "partial"
                        : "sufficient"
                    : "none",
            notes: synthesis?.ok
                ? "DAG 混合检索：语料 + 外部搜索已汇合"
                : "DAG 执行完成，部分节点无结果",
            toolResults,
            checkerPassed: true,
        };
    } catch (e) {
        const msg = e instanceof Error ? e.message : "DAG 执行失败";
        return { error: msg };
    }
};

export const runToolOrchestratorNode = async (
    state: PipelineGraphState
): Promise<Partial<PipelineGraphState>> => {
    if (state.decision?.routeMode === "dag") {
        logAgentOut("ToolOrchestrator", "跳过", { reason: "dag_already_executed" });
        return {};
    }

    const runs = resolvePostRetrievalToolRuns(state);
    if (runs.length === 0) return {};

    const results: PipelineToolResults = { ...(state.toolResults ?? {}) };
    for (const run of runs) {
        results[run.key] = await runExecutionPlanNode(run.node, {
            state,
            prior: results,
        });
    }

    logAgentOut("ToolOrchestrator", "完成", {
        keys: Object.keys(results),
    });
    return { toolResults: results };
};
