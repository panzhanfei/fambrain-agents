/**
 * composite 槽答案缓存 + 增量计划 单测。
 *
 *   pnpm --filter @fambrain/brain-service run verify:composite-incremental
 */
import {
    clearMemoryCompositeAnswerCache,
    resetInfraConfigForTests,
    upsertFacetAnswers,
} from "@fambrain/infra";
import {
    analystResultToCachedFacet,
    buildFacetKey,
    resolveIncrementalCompositePlan,
} from "../src/agentflow/brain-service/online/knowledge-manager";
import { planItemToSlot } from "../src/agentflow/brain-service/online/intake-coordinator";

process.env.REDIS_ENABLED = "0";
process.env.COMPOSITE_ANSWER_CACHE_DISABLED = "0";
resetInfraConfigForTests();
clearMemoryCompositeAnswerCache();

const fail = (name: string, msg: string): never => {
    console.error(`  ✗ ${name}: ${msg}`);
    process.exit(1);
};

const ok = (name: string) => console.log(`  ✓ ${name}`);

const session = {
    conversationId: "conv-test-1",
    corpusUserId: "user-a",
};

console.log("verify-composite-incremental\n— facetKey —");

{
    const name = buildFacetKey({
        label: "姓名",
        searchQuery: "x",
        queryType: "identity",
        topics: ["personal"],
    });
    const email = buildFacetKey({
        label: "邮箱多少",
        searchQuery: "x",
        queryType: "identity",
        topics: ["personal"],
    });
    const projects = buildFacetKey({
        label: "项目经历",
        searchQuery: "x",
        queryType: "enumeration",
        topics: ["project"],
    });
    const roles = buildFacetKey({
        label: "分别担任什么职位",
        searchQuery: "x",
        queryType: "enumeration",
        topics: ["experience"],
    });
    if (name !== "id:name" || email !== "id:email" || projects !== "enum:projects") {
        fail("姓名 / 邮箱 / 项目 分桶", `${name} ${email} ${projects}`);
    }
    if (roles !== "enum:employers:roles") {
        fail("职位独立 facetKey", roles);
    }
    ok("姓名 / 邮箱 / 项目 / 职位 分桶");
}

console.log("\n— 槽答案会话 —");

await upsertFacetAnswers(session, {
    facets: [
        analystResultToCachedFacet(
            "id:name",
            "姓名",
            {
                answer: "潘展飞",
                citations: [],
                confidence: 0.9,
                insufficientEvidence: false,
            },
            "sufficient"
        ),
        analystResultToCachedFacet(
            "enum:projects",
            "项目经历",
            {
                answer: "城管平台、E-HR",
                citations: [],
                confidence: 0.85,
                insufficientEvidence: false,
            },
            "partial"
        ),
    ],
    userQuestion: "我叫什么？做过哪些项目？",
    fullAnswer: "1. 姓名\n潘展飞\n\n2. 项目经历\n城管平台、E-HR",
    facetKeys: ["id:name", "enum:projects"],
});

const q1Slots = [
    planItemToSlot(
        {
            label: "姓名",
            searchQuery: "个人简介 简历 姓名",
            queryType: "identity",
            topics: ["personal", "resume"],
        },
        0
    ),
    planItemToSlot(
        {
            label: "项目经历",
            searchQuery: "项目经历 全部项目",
            queryType: "enumeration",
            topics: ["project"],
        },
        1
    ),
];

const q2Slots = [
    ...q1Slots,
    planItemToSlot(
        {
            label: "邮箱",
            searchQuery: "个人简介 简历 邮箱",
            queryType: "identity",
            topics: ["personal", "resume"],
        },
        2
    ),
    planItemToSlot(
        {
            label: "电话",
            searchQuery: "个人简介 简历 电话",
            queryType: "identity",
            topics: ["personal", "resume"],
        },
        3
    ),
];

{
    const plan = await resolveIncrementalCompositePlan({
        session,
        userQuestion: "我叫什么？ 做过那些项目？ 邮箱多少？ 电话多少？",
        slots: q2Slots,
    });
    if (plan.facetCacheHits !== 2) {
        fail("Q2 增量：命中 2", `facetCacheHits=${plan.facetCacheHits}`);
    }
    if (plan.activeRetrievalSlots.length !== 2) {
        fail("Q2 增量：仅 2 槽需检索", `active=${plan.activeRetrievalSlots.length}`);
    }
    const cached = plan.slots.filter((s) => s.useCachedAnswer);
    if (cached.length !== 2) {
        fail("Q2 增量：cached slots", `count=${cached.length}`);
    }
    ok("Q2 增量：命中 2 / 仅 2 槽需检索");
}

{
    const plan = await resolveIncrementalCompositePlan({
        session,
        userQuestion: "全部重来，重新介绍",
        slots: q2Slots,
    });
    if (plan.sessionCleared !== true || plan.facetCacheHits !== 0) {
        fail(
            "refresh 意图清空 session",
            `cleared=${plan.sessionCleared} hits=${plan.facetCacheHits}`
        );
    }
    ok("refresh 意图清空 session");
}

console.log("\nOK");
