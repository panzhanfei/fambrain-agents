/**
 * 混合 DAG：executionPlan 拓扑与汇合节点。
 *
 *   pnpm --filter @fambrain/brain-service run verify:dag-hybrid
 */
import assert from "node:assert/strict";
import {
    buildHybridExecutionPlan,
    invokeSynthesizeMerge,
    type ToolRunResult,
} from "../src/agentflow/agents/online/tool-orchestrator";
import {
    emptyPathPlan,
    type RoutedIntakeDecision,
} from "../src/agentflow/agents/online/intake-coordinator";

const ok = (msg: string) => console.log(`  ✓ ${msg}`);

const decision = (): RoutedIntakeDecision => ({
    intent: "retrieve_and_answer",
    language: "zh",
    subTasks: ["综合评估"],
    topics: ["personal"],
    confidence: 0.9,
    clarifyingQuestion: null,
    briefReply: null,
    searchQuery: "奥卡云 机会 评估",
    queryType: "default",
    retrievalPlan: [],
    routeMode: "dag",
    compositeSlots: [],
    pathPlan: {
        ...emptyPathPlan(),
        dag: [
            {
                id: "dag-hybrid",
                pathKind: "dag",
                label: "综合评估",
                template: "hybrid_multi_source",
            },
        ],
    },
    answerOrder: [],
    composeMode: "qa",
    routeReason: "intake_retrieval_plan",
    routePlanSource: "intake_retrieval_plan",
    userFactKey: null,
    userFactLabel: null,
    userFactValue: null,
});

console.log("verify-dag-hybrid\n— buildHybridExecutionPlan —");

{
    const plan = buildHybridExecutionPlan(
        "根据我的简历和今年市场行情，评估我去奥卡云公司的机会",
        decision()
    );
    assert.equal(plan.length, 4);
    const ids = plan.map((n) => n.id);
    assert.deepEqual(ids, ["resume", "company", "market", "synthesis"]);
    const wave0 = plan.filter((n) => n.deps.length === 0);
    assert.equal(wave0.length, 3);
    const synth = plan.find((n) => n.id === "synthesis")!;
    assert.deepEqual(synth.deps.sort(), ["company", "market", "resume"]);
    ok("混合计划含语料+双联网+汇合");
}

console.log("\n— invokeSynthesizeMerge —");

{
    const resume: ToolRunResult = {
        toolId: "retrieve_corpus",
        label: "个人简历",
        ok: true,
        answer: "前端工程师，React/TS 经验",
        citations: [{ path: "personal/简历.md", excerpt: "前端" }],
        hits: [],
        insufficientEvidence: false,
        confidence: 0.8,
    };
    const company: ToolRunResult = {
        toolId: "search_web",
        label: "目标公司",
        ok: true,
        answer: "1. 奥卡云：云计算公司",
        citations: [{ path: "https://example.com", excerpt: "云计算" }],
        hits: [],
        insufficientEvidence: false,
        confidence: 0.7,
    };
    const merged = invokeSynthesizeMerge({
        label: "综合评估",
        deps: [resume, company],
    });
    assert.equal(merged.insufficientEvidence, false);
    assert.match(merged.answer, /个人档案摘要/);
    assert.match(merged.answer, /目标公司/);
    ok(`汇合: ${merged.answer.slice(0, 60)}…`);
}

console.log("\nOK");
