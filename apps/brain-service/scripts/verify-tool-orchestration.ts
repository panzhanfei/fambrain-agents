/**
 * 四类架构：ToolOrchestrator + field-catalog 规划验证。
 *
 *   pnpm --filter @fambrain/brain-service run verify:tool-orchestration
 */
import assert from "node:assert/strict";
import {
    applyToolPlanGuard,
    decisionSuggestsHybridDag,
    pickToolResultForSubQuestion,
    resolveIdentityFieldFromPlan,
    resolvePostRetrievalToolRuns,
} from "../src/agentflow/agents/online/tool-orchestrator";
import {
    emptyPathPlan,
    type RoutedIntakeDecision,
} from "../src/agentflow/agents/online/intake-coordinator";
import type { KnowledgeHit } from "../src/agentflow/agents/online/knowledge-manager";
import type { PipelineGraphState } from "../src/agentflow/pipeline/graph/state";

const ok = (msg: string) => console.log(`  ✓ ${msg}`);

const baseDecision = (): RoutedIntakeDecision => ({
    intent: "retrieve_and_answer",
    language: "zh",
    subTasks: ["年龄"],
    topics: ["personal"],
    confidence: 0.9,
    clarifyingQuestion: null,
    briefReply: null,
    searchQuery: "年龄 出生日期",
    queryType: "identity",
    retrievalPlan: [
        {
            label: "年龄",
            searchQuery: "年龄 出生日期",
            queryType: "identity",
            topics: ["personal"],
            identityField: "age",
        },
    ],
    routeMode: "skip",
    compositeSlots: [],
    pathPlan: emptyPathPlan(),
    composeMode: "qa",
    routeReason: "slots_default",
    routePlanSource: "intake_retrieval_plan",
    userFactKey: null,
    userFactLabel: null,
    userFactValue: null,
});

const resumeHit = (excerpt: string): KnowledgeHit => ({
    path: "personal/个人简历.md",
    title: "个人简历",
    excerpt,
    relevance: 1,
});

console.log("verify-tool-orchestration\n— field-catalog —");

{
    const field = resolveIdentityFieldFromPlan({ identityField: "age" });
    assert.equal(field?.id, "age");
    assert.equal(field?.toolId, "compute_age_from_hits");
    ok("identityField=age → compute_age_from_hits");
}

{
    const field = resolveIdentityFieldFromPlan({ identityField: "name" });
    assert.equal(field?.id, "name");
    assert.equal(field?.toolId, "extract_identity_from_hits");
    ok("identityField=name → extract_identity_from_hits");
}

console.log("\n— applyToolPlanGuard —");

{
    const routed = applyToolPlanGuard(
        baseDecision(),
        "我今年多大"
    );
    const agePlan = routed.enrichedPlan?.find((p) => p.field === "age");
    assert.equal(agePlan?.toolId, "compute_age_from_hits");
    assert.equal(agePlan?.dataSource, "compute");
    ok("单问年龄 enrichedPlan 含 compute");
}

{
    const routed = applyToolPlanGuard(
        {
            ...baseDecision(),
            searchQuery: "奥卡云 公司 最近怎么样",
            queryType: "default",
            topics: ["external"],
            retrievalPlan: [
                {
                    label: "公司动态",
                    searchQuery: "奥卡云 公司 最近",
                    queryType: "default",
                    topics: ["external"],
                },
            ],
        },
        "奥卡云公司最近怎么样"
    );
    const webPlan = routed.enrichedPlan?.find((p) => p.dataSource === "web");
    assert.equal(webPlan?.toolId, "search_web");
    ok("topics=external → enrichedPlan search_web");
}

console.log("\n— hybrid DAG intent —");

{
    const q =
        "根据我的简历和今年市场行情，评估我去奥卡云公司的机会";
    assert.ok(
        decisionSuggestsHybridDag({
            topics: ["personal", "resume", "external"],
        })
    );
    const routed = applyToolPlanGuard(
        {
            ...baseDecision(),
            topics: ["personal", "resume", "external"],
            searchQuery: "奥卡云 公司 机会 评估",
            retrievalPlan: [
                {
                    label: "简历匹配",
                    searchQuery: "个人简介 简历 技能",
                    queryType: "identity",
                    topics: ["personal", "resume"],
                },
                {
                    label: "市场行情",
                    searchQuery: "市场行情 招聘",
                    queryType: "default",
                    topics: ["external"],
                },
            ],
        },
        q
    );
    assert.equal(routed.routeMode, "dag");
    assert.ok((routed.executionPlan?.length ?? 0) >= 3);
    const synth = routed.executionPlan?.find((n) => n.id === "synthesis");
    assert.ok(synth?.deps.includes("resume"));
    ok("topics 含 external+corpus → routeMode=dag + executionPlan");
}

console.log("\n— resolvePostRetrievalToolRuns —");

{
    const decision = applyToolPlanGuard(baseDecision(), "我今年多大");
    const state = {
        decision,
        userQuestion: "我今年多大",
        hits: [resumeHit("| 出生日期 | 1993.03 |")],
        coverage: "sufficient",
        compositeSubResults: null,
    } as Pick<
        PipelineGraphState,
        "decision" | "userQuestion" | "hits" | "coverage" | "compositeSubResults"
    > as PipelineGraphState;

    const runs = resolvePostRetrievalToolRuns(state);
    assert.ok(runs.some((r) => r.key === "age"));
    ok("KM 后解析年龄工具 run");
}

console.log("\n— pickToolResultForSubQuestion —");

{
    const picked = pickToolResultForSubQuestion(
        {
            userQuestion: "我今年多大",
            language: "zh",
            hits: [resumeHit("| 出生日期 | 1993.03 |")],
            coverage: "sufficient",
            notes: null,
            queryType: "identity",
            identityField: "age",
            facetKey: "id:age",
            toolResults: {
                age: {
                    toolId: "compute_age_from_hits",
                    label: "年龄",
                    ok: true,
                    answer: "33 岁",
                    citations: [],
                    hits: [],
                    insufficientEvidence: false,
                    confidence: 0.9,
                },
            },
        },
        {
            age: {
                toolId: "compute_age_from_hits",
                label: "年龄",
                ok: true,
                answer: "33 岁",
                citations: [],
                hits: [],
                insufficientEvidence: false,
                confidence: 0.9,
            },
        }
    );
    assert.equal(picked?.answer, "33 岁");
    ok("Analyst 优先消费 toolResults.age");
}

console.log("\nOK");
