/**
 * 诊断：混合问「列出所有项目 + 开源 GitHub/线上地址」
 *
 *   pnpm --filter @fambrain/brain-service exec tsx --env-file=../../.env scripts/diagnose-mixed-projects-github-query.ts
 */
import assert from "node:assert/strict";
import { runIntakePipeline } from "../src/agentflow/agents/online/intake-coordinator/pipeline/intake-pipeline";
import {
    composeEnumerationAnswer,
    mergeCompositeWithBlocks,
} from "../src/agentflow/agents/online/information-analyst/compose-message";
import type { KnowledgeHit } from "../src/agentflow/agents/online/knowledge-manager";

const USER_QUESTION =
    "帮我列出 所有我做过的项目，并且告诉我 他开源项目的githup地址跟线上地址";

/** 模拟 Intake LLM 正确路由（enum + external_link）— 与 prompt 示例 16 对齐 */
const mockIntakeJson = JSON.stringify({
    intent: "retrieve_and_answer",
    searchQuery: "项目经历 开源 GitHub 线上地址",
    subTasks: ["列举所有项目", "开源项目的 GitHub 与线上地址"],
    topics: ["project", "personal"],
    language: "zh",
    confidence: 0.9,
    queryType: "enumeration",
    clarifyingQuestion: null,
    briefReply: null,
    retrievalPlan: [
        {
            label: "列举所有项目名称",
            searchQuery: "项目经历 全部项目 项目名称",
            queryType: "enumeration",
            topics: ["project"],
            enumerationControl: { action: "preview", listKind: "project" },
        },
        {
            label: "开源项目的 GitHub 与线上地址",
            searchQuery:
                "个人简介 简历 开源 对外链接 仓库地址 线上预览 URL GitHub",
            queryType: "external_link",
            topics: ["personal", "resume", "project"],
        },
    ],
    userFactKey: null,
    userFactLabel: null,
    userFactValue: null,
});

const mkHits = (n: number): KnowledgeHit[] =>
    Array.from({ length: n }, (_, i) => ({
        path: `data/doc/users/u/corpus/projects/p-${i + 1}.md`,
        title: i === 0 ? "Sentinel" : i === 1 ? "release-bot" : `project-${i + 1}`,
        excerpt: `summary ${i + 1}`,
        relevance: 0.9 - i * 0.05,
    }));

console.log("diagnose-mixed-projects-github-query\n");

console.log("— 1. Intake pipeline（正确 enum + external_link）—");
const { decision } = await runIntakePipeline({
    intakeRaw: mockIntakeJson,
    userQuestion: USER_QUESTION,
    intakeHistory: [],
});
console.log("  routeMode:", decision.routeMode);
console.log("  slotCount:", decision.compositeSlots?.length ?? 0);
for (const slot of decision.compositeSlots ?? []) {
    console.log(
        `  slot ${slot.id}: queryType=${slot.queryType} label=${JSON.stringify(slot.label)}`
    );
}
const types = (decision.compositeSlots ?? []).map((s) => s.queryType);
assert.ok(types.includes("enumeration"), "应含 enumeration");
assert.ok(types.includes("external_link"), "应含 external_link");
const ids = (decision.compositeSlots ?? []).map((s) => s.id);
assert.equal(new Set(ids).size, ids.length, "槽 id 唯一");
console.log("  ✓ 混合槽 + 唯一 id");

console.log("\n— 2. 列举 compose（actions 按钮）—");
const composed = composeEnumerationAnswer({
    hits: mkHits(8),
    language: "zh",
    topics: ["project"],
    enumerationMeta: {
        listKind: "project",
        totalExpected: 36,
        shown: 8,
        hasMore: true,
    },
    listIntent: "preview",
});
const actionBlock = composed.blocks?.find((b) => b.type === "actions");
assert.ok(actionBlock && actionBlock.type === "actions");
assert.equal(actionBlock.actions[0]?.prompt, "列出全部项目名称");
console.log("  ✓ actions prompt =", actionBlock.actions[0]?.prompt);

console.log("\n— 3. composite merge 保留 actions —");
const merged = mergeCompositeWithBlocks([
    {
        order: 0,
        label: "列举所有项目",
        result: composed,
    },
    {
        order: 1,
        label: "开源 GitHub",
        result: {
            answer: "https://github.com/example/repo",
            citations: [],
            confidence: 0.8,
            insufficientEvidence: false,
        },
    },
]);
assert.ok(merged.blocks.some((b) => b.type === "actions"));
console.log("  ✓ merged blocks:", merged.blocks.map((b) => b.type).join(", "));

console.log("\nOK");
