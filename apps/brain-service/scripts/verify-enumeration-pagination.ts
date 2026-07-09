/**
 * 列举分页：continuation 检测、list API、L3 blocks cache。
 *
 *   pnpm --filter @fambrain/brain-service exec tsx scripts/verify-enumeration-pagination.ts
 */
import assert from "node:assert/strict";
import {
    applyEnumerationListIntentGuard,
    buildEnumerationListDecision,
    detectEnumerationContinuationKind,
    isExhaustiveListRequest,
    resolveEnumerationContinuation,
} from "../src/agentflow/brain-service/online/intake-coordinator/guards/enumeration-list-intent";
import {
    analystResultToCachedFacet,
    cachedFacetToAnalystResult,
} from "../src/agentflow/brain-service/online/intake-coordinator/composite/composite-incremental";
import { composeEnumerationAnswer } from "../src/agentflow/brain-service/online/information-analyst/compose-message";
import { listCorpusEntriesPage } from "../src/agentflow/brain-service/online/knowledge-manager/list/list-corpus-entries";
import { retrieveEnumerationPage } from "../src/agentflow/brain-service/online/knowledge-manager/list/retrieve-enumeration-page";
import {
    clearMemoryEnumerationListSessions,
    upsertEnumerationListSession,
} from "@fambrain/infra";

console.log("verify-enumeration-pagination");

assert.equal(isExhaustiveListRequest("列出全部36个项目"), true);
assert.equal(isExhaustiveListRequest("做过哪些项目"), false);
assert.equal(detectEnumerationContinuationKind("更多项目"), "project");
assert.equal(detectEnumerationContinuationKind("更多经历"), "experience");

const exhaustiveDecision = buildEnumerationListDecision({
    userQuestion: "列出全部项目名称",
    listKind: "project",
    listIntent: "exhaustive",
    page: 1,
    pageSize: 20,
});
assert.equal(exhaustiveDecision.listIntent, "exhaustive");
assert.equal(exhaustiveDecision.enumerationPageSize, 20);

const guarded = applyEnumerationListIntentGuard(
    {
        ...exhaustiveDecision,
        listIntent: null,
        routeMode: "single",
        compositeSlots: [],
        searchQuery: "项目",
        queryType: "enumeration",
    },
    "请把全部36个项目都列出来"
);
assert.equal(guarded.listIntent, "exhaustive");

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
assert.ok(cached.blocks?.length, "L3 cache stores blocks");
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
        assert.ok(page2.enumerationMeta?.hasMore === false || page2.hits.length > 0);
    }
    console.log(`live corpus projects total=${page1.total}`);
} else {
    console.log("skip live corpus (set FAMBRAIN_CORPUS_USER_ID for e2e)");
}

console.log("OK");
