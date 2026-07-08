/**
 * P0-16：Intake 结构化 user_fact + Mem0 JSON 存储。
 *
 *   pnpm --filter @fambrain/brain-service run verify:user-fact
 */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
    applyUserFactFromIntake,
    buildEarlyExitRoutedDecision,
    findUserFactValueInTexts,
    parseUserFactRecord,
    routeUserFactFromIntake,
    serializeUserFactRecord,
    type IntakeRoutingDecision,
} from "../src/agentflow/brain-service/online/intake-coordinator";
import { userFactNode } from "../src/agentflow/brain-service/online/user-fact";
import type { PipelineGraphState } from "../src/agentflow/pipeline/graph/state";

const QQ = "734858469";
const WECHAT = "panzf_wx";

const rememberIntake = (): IntakeRoutingDecision => ({
    intent: "remember_user_fact",
    needsRetrieval: false,
    searchQuery: "",
    subTasks: [],
    topics: [],
    language: "zh",
    confidence: 0.95,
    queryType: null,
    clarifyingQuestion: null,
    briefReply: null,
    retrievalPlan: [],
    userFactKey: "qq",
    userFactLabel: "QQ号",
    userFactValue: QQ,
});

const recallIntake = (): IntakeRoutingDecision => ({
    intent: "recall_user_fact",
    needsRetrieval: false,
    searchQuery: "",
    subTasks: [],
    topics: [],
    language: "zh",
    confidence: 0.95,
    queryType: null,
    clarifyingQuestion: null,
    briefReply: null,
    retrievalPlan: [],
    userFactKey: "qq",
    userFactLabel: "QQ号",
    userFactValue: null,
});

const wechatRememberIntake = (): IntakeRoutingDecision => ({
    intent: "remember_user_fact",
    needsRetrieval: false,
    searchQuery: "",
    subTasks: [],
    topics: [],
    language: "zh",
    confidence: 0.93,
    queryType: null,
    clarifyingQuestion: null,
    briefReply: null,
    retrievalPlan: [],
    userFactKey: "wechat",
    userFactLabel: "微信号",
    userFactValue: WECHAT,
});

const baseState = (
    userQuestion: string,
    overrides: Partial<PipelineGraphState> = {}
): PipelineGraphState => ({
    history: overrides.history ?? [{ role: "user", content: userQuestion }],
    context: {
        actorUserId: "verify-user-fact",
        corpusUserId: "verify-user-fact",
        displayName: "Test",
        conversationId: "conv-a",
        ...overrides.context,
    },
    userQuestion,
    decision: null,
    hits: [],
    coverage: "none",
    notes: null,
    answer: null,
    error: null,
    exitEarly: false,
    checkerPassed: true,
    retryCount: 0,
    memoryBlock: null,
    userMemories: [],
    intakeHistory: overrides.intakeHistory ?? [],
    confidenceTier: null,
    repeatQuestionHit: false,
    retrievalCacheHit: false,
    retrievalCacheSlotHits: null,
    compositeSubResults: null,
    compositeIncrementalPlan: null,
    compositeFacetCacheHits: null,
    ...overrides,
});

console.log("verify-user-fact\n— Intake 结构化路由 —");

const rememberRoute = routeUserFactFromIntake(rememberIntake());
assert.ok(rememberRoute);
assert.equal(rememberRoute!.action, "remember");
assert.equal(rememberRoute!.factKey, "qq");
assert.equal(rememberRoute!.value, QQ);

const recallRoute = routeUserFactFromIntake(recallIntake());
assert.ok(recallRoute);
assert.equal(recallRoute!.action, "recall");

assert.equal(routeUserFactFromIntake({
    ...recallIntake(),
    intent: "clarify",
}), null);

const routed = applyUserFactFromIntake(rememberIntake(), rememberRoute!);
assert.equal(routed.needsRetrieval, false);
assert.equal(routed.userFact?.factKey, "qq");
assert.equal(routed.compositeSlots.length, 0);

const wechatRoute = routeUserFactFromIntake(wechatRememberIntake());
assert.equal(wechatRoute?.factKey, "wechat");
assert.equal(wechatRoute?.value, WECHAT);

const serialized = serializeUserFactRecord({
    factKey: "wechat",
    label: "微信号",
    value: WECHAT,
});
const parsed = parseUserFactRecord(serialized);
assert.equal(parsed?.value, WECHAT);

// 回归：Mem0 自然语言行「QQ号是734858469」不能误提取为「码」
assert.equal(
    findUserFactValueInTexts(["QQ号是734858469"], "qq", "QQ号"),
    QQ,
    "QQ号是734858469 应提取完整 QQ"
);
assert.equal(
    findUserFactValueInTexts(
        [`请记住我的QQ号：${QQ}（字段 qq）`],
        "qq",
        "QQ号"
    ),
    QQ
);
assert.equal(findUserFactValueInTexts(["QQ号是码"], "qq", "QQ号"), null);

console.log("✓ Intake schema → userFact route");

console.log("\n— Mem0 跨会话（需 Ollama · MEM0_ENABLED 默认 true）—");

const main = async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "fambrain-uf-"));
    process.env.MEM0_HISTORY_DB_PATH = path.join(tmp, "history.db");
    process.env.LANGMEM_ENABLED = "false";
    const { resetMemoryConfigCache, addStructuredUserFact, searchUserFactMemories } =
        await import("@fambrain/brain-memory");
    resetMemoryConfigCache();

    const userId = `uf-${Date.now()}`;
    await addStructuredUserFact({
        userId,
        factKey: "qq",
        label: "QQ号",
        value: QQ,
    });

    const memories = await searchUserFactMemories(
        userId,
        "qq",
        "QQ号",
        "我的qq是多少"
    );
    assert.ok(memories.length >= 1, "Mem0 search 应至少 1 条");
    assert.equal(findUserFactValueInTexts(memories, "qq", "QQ号"), QQ);

    const recallState = baseState("我的qq是多少", {
        context: {
            actorUserId: userId,
            corpusUserId: userId,
            displayName: "Test",
            conversationId: "conv-b",
        },
        decision: buildEarlyExitRoutedDecision(recallIntake()),
        userMemories: memories,
        memoryBlock: `### 用户长期记忆（Mem0）\n- ${serializeUserFactRecord({ factKey: "qq", label: "QQ号", value: QQ })}`,
    });

    const recallOut = await userFactNode(recallState);
    assert.ok(recallOut.answer?.includes(QQ), `recall 应答含 QQ: ${recallOut.answer}`);

    const rememberState = baseState(`我的qq是${QQ} 请帮我记住`, {
        context: {
            actorUserId: userId,
            corpusUserId: userId,
            displayName: "Test",
            conversationId: "conv-c",
        },
        decision: buildEarlyExitRoutedDecision(rememberIntake()),
    });
    const rememberOut = await userFactNode(rememberState);
    assert.ok(
        rememberOut.answer?.includes(QQ),
        `remember 确认应答含 QQ: ${rememberOut.answer}`
    );

    console.log("✓ Mem0 remember → 新 conversation recall");

    await rm(tmp, { recursive: true, force: true });
    console.log("\nverify-user-fact OK");
};

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
