/**
 * 列举分页：UI exact-match、按槽 list_corpus、list API、槽答案 blocks cache。
 *
 *   pnpm --filter @fambrain/brain-service run verify:enumeration-pagination
 */
import assert from "node:assert/strict";
import {
    applyEnumerationSlotGuard,
    buildEnumerationListDecision,
    detectEnumerationContinuationKind,
    isExhaustiveListRequest,
    matchUiEnumerationPrompt,
    resolveEnumerationContinuation,
    runIntakePipeline,
} from "../src/agentflow/agents/online/intake-coordinator";
import {
    analystResultToCachedFacet,
    cachedFacetToAnalystResult,
} from "../src/agentflow/agents/online/knowledge-manager";
import { composeEnumerationAnswer } from "../src/agentflow/agents/online/information-analyst/compose-message";
import { listCorpusEntriesPage } from "../src/agentflow/agents/online/corpus-lister";
import { retrieveEnumerationPage } from "../src/agentflow/agents/online/corpus-lister";
import {
    clearMemoryEnumerationListSessions,
    upsertEnumerationListSession,
} from "@fambrain/infra";

console.log("verify-enumeration-pagination");

// UI exact-match only（无口语 regex）
assert.equal(isExhaustiveListRequest("列出全部项目名称"), true);
assert.equal(isExhaustiveListRequest("做过哪些项目"), false);
assert.equal(isExhaustiveListRequest("列出全部36个项目"), false);
assert.equal(detectEnumerationContinuationKind("更多项目"), "project");
assert.equal(detectEnumerationContinuationKind("更多经历"), "experience");
assert.equal(matchUiEnumerationPrompt("更多项目")?.action, "continue");

const exhaustiveDecision = buildEnumerationListDecision({
    userQuestion: "列出全部项目名称",
    listKind: "project",
    listIntent: "exhaustive",
    page: 1,
    pageSize: 20,
});
assert.equal(exhaustiveDecision.listIntent, "exhaustive");
assert.equal(exhaustiveDecision.routeMode, "slots");
assert.equal(exhaustiveDecision.compositeSlots[0]?.executor, "list_corpus");
assert.equal(exhaustiveDecision.enumerationPageSize, 20);

const session = { conversationId: "c-enum", corpusUserId: "u-enum" };
const guarded = await applyEnumerationSlotGuard(
    {
        ...exhaustiveDecision,
        listIntent: null,
        routeMode: "slots",
        compositeSlots: [
            {
                id: "projects",
                label: "项目经历",
                searchQuery: "项目",
                queryType: "enumeration",
                topics: ["project"],
                subTasks: [],
                enumerationControl: {
                    action: "exhaustive",
                    listKind: "project",
                },
            },
        ],
        searchQuery: "项目",
        queryType: "enumeration",
    },
    "任意问法",
    session
);
assert.equal(guarded.listIntent, "exhaustive");
assert.equal(guarded.routeMode, "slots");
assert.equal(guarded.compositeSlots[0]?.executor, "list_corpus");

// 混合问：tech + list 槽
const mixedRaw = JSON.stringify({
    intent: "retrieve_and_answer",
    searchQuery: "城管 技术栈 项目",
    subTasks: ["城管技术", "全部项目"],
    topics: ["project", "tech-stack"],
    language: "zh",
    confidence: 0.9,
    queryType: "tech",
    clarifyingQuestion: null,
    briefReply: null,
    retrievalPlan: [
        {
            label: "城管平台技术栈",
            searchQuery: "城市管理平台 技术栈",
            queryType: "tech",
            topics: ["project", "tech-stack"],
            enumerationControl: null,
        },
        {
            label: "其它项目全部列出",
            searchQuery: "项目经历 全部项目",
            queryType: "enumeration",
            topics: ["project"],
            enumerationControl: {
                action: "exhaustive",
                listKind: "project",
                excludeHint: "城管",
            },
        },
    ],
    userFactKey: null,
    userFactLabel: null,
    userFactValue: null,
});
const { decision: mixed } = await runIntakePipeline({
    intakeRaw: mixedRaw,
    userQuestion:
        "城管平台用了那些技术？他除了城管还做了其他那些项目全部列出。",
    intakeHistory: [],
    session,
});
assert.equal(mixed.routeMode, "slots");
assert.ok(mixed.compositeSlots.length >= 2, "mixed ≥2 slots");
const execs = mixed.compositeSlots.map((s) => s.executor ?? "km_retrieve");
assert.ok(execs.includes("km_retrieve"), "tech slot km");
assert.ok(execs.includes("list_corpus"), "list slot list_corpus");

const composed = composeEnumerationAnswer({
    hits: Array.from({ length: 20 }, (_, i) => ({
        path: `data/doc/users/u/corpus/projects/p-${i}.md`,
        title: `p-${i}`,
        excerpt: `summary ${i}`,
        relevance: 0.5,
    })),
    language: "zh",
    topics: ["project"],
    enumerationMeta: {
        listKind: "project",
        totalExpected: 36,
        shown: 20,
        page: 1,
        pageSize: 20,
        hasMore: true,
    },
    listIntent: "exhaustive",
});
const enumBlock = composed.blocks!.find((b) => b.type === "enumeration");
assert.ok(enumBlock && enumBlock.type === "enumeration");
assert.equal(enumBlock.page, 1);
assert.equal(enumBlock.pageSize, 20);
assert.equal(enumBlock.hasMore, true);
const actionBlock = composed.blocks!.find((b) => b.type === "actions");
assert.ok(actionBlock && actionBlock.type === "actions");
assert.equal(actionBlock.actions[0]?.prompt, "更多项目");

const cached = analystResultToCachedFacet(
    "facet:projects",
    "项目经历",
    composed,
    "partial"
);
assert.ok(cached.blocks?.length, "槽答案缓存 stores blocks");
const restored = cachedFacetToAnalystResult(cached);
assert.equal(restored.blocks?.length, composed.blocks?.length);

clearMemoryEnumerationListSessions();
await upsertEnumerationListSession(
    { conversationId: "c1", corpusUserId: "u1" },
    "project",
    { lastPage: 1, pageSize: 8, total: 36 }
);
const continued = await resolveEnumerationContinuation({
    userQuestion: "更多项目",
    session: { conversationId: "c1", corpusUserId: "u1" },
});
assert.ok(continued);
assert.equal(continued!.listIntent, "continue");
assert.equal(continued!.enumerationPage, 2);
assert.equal(continued!.routeMode, "slots");
assert.equal(continued!.compositeSlots[0]?.executor, "list_corpus");

const corpusUserId = process.env.FAMBRAIN_CORPUS_USER_ID?.trim();
if (corpusUserId) {
    const page1 = await listCorpusEntriesPage({
        corpusUserId,
        listKind: "project",
        page: 1,
        pageSize: 20,
    });
    assert.ok(page1.total >= 0);
    if (page1.total > 20) {
        assert.equal(page1.hasMore, true);
        const page2 = await retrieveEnumerationPage({
            corpusUserId,
            listKind: "project",
            page: 2,
            pageSize: 20,
        });
        assert.ok(
            page2.enumerationMeta?.hasMore === false || page2.hits.length > 0
        );
    }
    console.log(`live corpus projects total=${page1.total}`);
} else {
    console.log("skip live corpus (set FAMBRAIN_CORPUS_USER_ID for e2e)");
}

console.log("OK");
