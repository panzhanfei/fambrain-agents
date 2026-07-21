/**
 * Intake 多轮指代 — pipeline 早退单测 + Intake live 抽检。
 *
 *   pnpm --filter @fambrain/brain-service run verify:intake-coreference
 */
import type { DbChatTurn } from "@fambrain/brain-types";
import { resetInfraConfigForTests } from "@fambrain/infra";
import {
    completeIntakeCoordinator,
    isClarifyEarlyExit,
    normalizeIntakeUtterance,
    parseIntakeDecision,
    rewriteLastUserTurn,
    runIntakePipeline,
    shouldRetryCoreferenceMerge,
    shouldShortCircuitIncompleteUtterance,
} from "../src/agentflow/agents/online/intake-coordinator/index";
import { findRepeatAnswerInHistory } from "../src/agentflow/agents/online/repeat-question-guard";
import { bootstrapBrainServiceRuntime } from "../src/config/index";
import { enableRepeatGuardForVerify } from "./verify-test-env";

const assertCase = async (name: string, fn: () => void | Promise<void>) => {
    try {
        await fn();
        console.log(`  ✓ ${name}`);
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`  ✗ ${name}: ${msg}`);
        process.exitCode = 1;
    }
};

const clarifyJson = JSON.stringify({
    intent: "clarify",
    searchQuery: "",
    subTasks: [],
    topics: ["project"],
    language: "zh",
    confidence: 0.55,
    queryType: null,
    clarifyingQuestion: "你指的是哪一段经历或哪个项目？",
    briefReply: null,
    retrievalPlan: [],
});

const retrieveWithEntityJson = JSON.stringify({
    intent: "retrieve_and_answer",
    searchQuery: "西安奥卡云 城市管理平台 技术栈",
    subTasks: [],
    topics: ["project"],
    language: "zh",
    confidence: 0.88,
    queryType: "tech",
    clarifyingQuestion: null,
    briefReply: null,
    retrievalPlan: [],
});

console.log("verify-intake-coreference\n— 指代重试判定 / 单字短路（无 LLM） —");

await assertCase("unresolved + 有上文 → 应拼接重试", async () => {
    const history: DbChatTurn[] = [
        { role: "user", content: "城管平台用了什么技术" },
        { role: "assistant", content: "城市管理平台使用 React。" },
        { role: "user", content: "那个项目呢？" },
    ];
    const r = shouldRetryCoreferenceMerge(
        { intent: "clarify", coreference: "unresolved" },
        "那个项目呢？",
        history
    );
    if (!r.retry || !r.mergedQuestion?.includes("城管平台用了什么技术")) {
        throw new Error(`重试判定失败: ${JSON.stringify(r)}`);
    }
});

await assertCase("resolved → 不重试", async () => {
    const history: DbChatTurn[] = [
        { role: "user", content: "城管平台用了什么技术" },
        { role: "assistant", content: "城市管理平台使用 React。" },
        { role: "user", content: "那个项目呢？" },
    ];
    const r = shouldRetryCoreferenceMerge(
        { intent: "retrieve_and_answer", coreference: "resolved" },
        "那个项目呢？",
        history
    );
    if (r.retry) throw new Error("已 resolved 不应重试");
});

await assertCase("单字无上文 → 应短路", async () => {
    if (!shouldShortCircuitIncompleteUtterance("嗯", [])) {
        throw new Error("「嗯」应短路");
    }
});

await assertCase("单字有上文 → 不短路", async () => {
    const history: DbChatTurn[] = [
        { role: "user", content: "城管平台用了什么技术" },
        { role: "assistant", content: "城市管理平台使用 React TypeScript。" },
        { role: "user", content: "呢" },
    ];
    if (shouldShortCircuitIncompleteUtterance("呢", history)) {
        throw new Error("有上文的「呢」不应短路");
    }
});

await assertCase("重复敲字 normalize 后按单字短路", async () => {
    if (normalizeIntakeUtterance("呢呢呢？？？") !== "呢？") {
        throw new Error(`normalize 失败: ${normalizeIntakeUtterance("呢呢呢？？？")}`);
    }
    if (!shouldShortCircuitIncompleteUtterance("嗯嗯嗯！！！", [])) {
        throw new Error("重复附和应短路");
    }
});

await assertCase("散文 peek=null → 不触发指代重试", async () => {
    const history: DbChatTurn[] = [
        { role: "user", content: "城管平台用了什么技术" },
        { role: "assistant", content: "城市管理平台使用 React。" },
        { role: "user", content: "那个项目呢？" },
    ];
    const r = shouldRetryCoreferenceMerge(null, "那个项目呢？", history);
    if (r.retry) throw new Error("无 JSON peek 不应拼接重试");
});

console.log("\n— pipeline 单测（LLM JSON 透传） —");

await assertCase("isClarifyEarlyExit：clarify + 反问", async () => {
    const parsed = parseIntakeDecision(clarifyJson);
    if (!parsed || !isClarifyEarlyExit(parsed)) {
        throw new Error("应识别为 clarify 早退");
    }
});

await assertCase("pipeline：LLM clarify → earlyExit", async () => {
    const history: DbChatTurn[] = [{ role: "user", content: "那个项目呢？" }];
    const { decision, earlyExit } = await runIntakePipeline({
        intakeRaw: clarifyJson,
        userQuestion: "那个项目呢？",
        intakeHistory: history,
    });
    if (!earlyExit || decision.intent !== "clarify") {
        throw new Error(
            `期望 earlyExit+clarify，实际 earlyExit=${earlyExit} intent=${decision.intent}`
        );
    }
    if (decision.routeReason !== "skip_non_retrieve") {
        throw new Error(`期望 skip_non_retrieve，实际 ${decision.routeReason}`);
    }
});

await assertCase("pipeline：LLM retrieve 含实体 → 非早退", async () => {
    const history: DbChatTurn[] = [
        { role: "user", content: "城管平台用了什么技术" },
        { role: "assistant", content: "React TypeScript" },
        { role: "user", content: "那个项目呢？" },
    ];
    const { decision, earlyExit } = await runIntakePipeline({
        intakeRaw: retrieveWithEntityJson,
        userQuestion: "那个项目呢？",
        intakeHistory: history,
    });
    if (earlyExit) {
        throw new Error("有实体 retrieve 不应 pipeline 早退");
    }
    if (decision.intent !== "retrieve_and_answer") {
        throw new Error("应为 retrieve_and_answer");
    }
});

await assertCase("pipeline：多问 retrieve → composite", async () => {
    const contradictory = JSON.stringify({
        intent: "retrieve_and_answer",
        searchQuery: "个人简介 简历 姓名 年龄 项目经历",
        subTasks: ["姓名", "年龄", "项目经历列举"],
        topics: ["personal", "resume", "project"],
        language: "zh",
        confidence: 0.9,
        queryType: "identity",
        clarifyingQuestion: null,
        briefReply: null,
        retrievalPlan: [
            {
                label: "姓名",
                searchQuery: "个人简介 简历 姓名 全名",
                queryType: "identity",
                topics: ["personal", "resume"],
            },
            {
                label: "年龄",
                searchQuery: "个人简介 简历 年龄 出生年份",
                queryType: "identity",
                topics: ["personal", "resume"],
            },
            {
                label: "项目经历",
                searchQuery: "项目经历 全部项目 项目名称 职责",
                queryType: "enumeration",
                topics: ["project"],
            },
        ],
        userFactKey: null,
        userFactLabel: null,
        userFactValue: null,
    });
    const { decision, earlyExit } = await runIntakePipeline({
        intakeRaw: contradictory,
        userQuestion: "我叫什么？今年多大？做过哪些项目？",
        intakeHistory: [{ role: "user", content: "我叫什么？今年多大？做过哪些项目？" }],
    });
    if (earlyExit) {
        throw new Error("retrieve 不应早退");
    }
    if (decision.routeMode !== "slots" || (decision.compositeSlots?.length ?? 0) < 2) {
        throw new Error(`期望 slots≥2，实际 ${decision.routeMode}/${decision.compositeSlots?.length ?? 0}`);
    }
});

console.log("\n— repeat guard 单测 —");

await bootstrapBrainServiceRuntime();
enableRepeatGuardForVerify();

await assertCase("repeat：同句再问命中 history 答", async () => {
    const q = "我叫什么，我做过什么项目？";
    const history: DbChatTurn[] = [
        { role: "user", content: q },
        { role: "assistant", content: "你是潘展飞，做过城管平台等项目。" },
        { role: "user", content: q },
    ];
    const hit = findRepeatAnswerInHistory(history, q);
    if (!hit?.includes("潘展飞")) {
        throw new Error(`应命中上轮答: ${hit ?? "null"}`);
    }
});

await assertCase("repeat：标点差异仍命中", async () => {
    const history: DbChatTurn[] = [
        { role: "user", content: "城管平台用了什么技术" },
        { role: "assistant", content: "React + TypeScript" },
        { role: "user", content: "城管平台用了什么技术？" },
    ];
    const hit = findRepeatAnswerInHistory(history, "城管平台用了什么技术？");
    if (!hit?.includes("React")) {
        throw new Error(`标点归一化应命中: ${hit ?? "null"}`);
    }
});

await assertCase("repeat：首次提问不命中", async () => {
    const hit = findRepeatAnswerInHistory(
        [{ role: "user", content: "你好" }],
        "你好"
    );
    if (hit) throw new Error("首次问不应命中");
});

await assertCase("repeat：REPEAT_QUESTION_CACHE_DISABLED=1 时不命中", async () => {
    process.env.REPEAT_QUESTION_CACHE_DISABLED = "1";
    resetInfraConfigForTests();
    const q = "我今年多大";
    const history: DbChatTurn[] = [
        { role: "user", content: q },
        { role: "assistant", content: "33 岁" },
        { role: "user", content: q },
    ];
    const hit = findRepeatAnswerInHistory(history, q);
    delete process.env.REPEAT_QUESTION_CACHE_DISABLED;
    resetInfraConfigForTests();
    if (hit) throw new Error("同问短路关闭时不应命中");
    enableRepeatGuardForVerify();
});

console.log("\n— Intake live + pipeline（可能 2× Intake LLM） —");

/** 与 intake-node 一致：normalize → LLM →（非 JSON 则格式修复）→（JSON 指代则拼接）→ pipeline */
const runLiveLikeIntakeNode = async (history: DbChatTurn[]) => {
    const lastUser =
        [...history].reverse().find((t) => t.role === "user")?.content ?? "";
    const normalized =
        normalizeIntakeUtterance(lastUser) || lastUser.trim() || lastUser;
    let effectiveQuestion = normalized;
    let intakeHistoryForLlm =
        normalized !== lastUser.trim()
            ? rewriteLastUserTurn(history, normalized)
            : history;
    let raw = await completeIntakeCoordinator(intakeHistoryForLlm, {
        intakeHistory: intakeHistoryForLlm,
    });
    let peek = parseIntakeDecision(raw);
    if (!peek) {
        console.log("    … JSON 格式修复重试");
        raw = await completeIntakeCoordinator(intakeHistoryForLlm, {
            intakeHistory: intakeHistoryForLlm,
            jsonFormatRepair: true,
        });
        peek = parseIntakeDecision(raw);
    }
    const mergeRetry = shouldRetryCoreferenceMerge(peek, effectiveQuestion, history);
    if (mergeRetry.retry && mergeRetry.mergedQuestion) {
        console.log(
            `    … 指代拼接重试: ${effectiveQuestion} → ${mergeRetry.mergedQuestion}`
        );
        effectiveQuestion = mergeRetry.mergedQuestion;
        intakeHistoryForLlm = rewriteLastUserTurn(history, effectiveQuestion);
        raw = await completeIntakeCoordinator(intakeHistoryForLlm, {
            intakeHistory: intakeHistoryForLlm,
            coreferenceMergeRetry: true,
        });
    }
    return runIntakePipeline({
        intakeRaw: raw,
        userQuestion: effectiveQuestion,
        intakeHistory: intakeHistoryForLlm,
    });
};

const assertLive = async (
    name: string,
    history: DbChatTurn[],
    check: (result: Awaited<ReturnType<typeof runIntakePipeline>>) => void
) => {
    try {
        const result = await runLiveLikeIntakeNode(history);
        check(result);
        console.log(`  ✓ ${name}`);
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`  ✗ ${name}: ${msg}`);
        process.exitCode = 1;
    }
};

await assertLive(
    "单轮「那个项目呢？」→ 非检索早退（clarify 优先）",
    [{ role: "user", content: "那个项目呢？" }],
    ({ decision, earlyExit }) => {
        if (!earlyExit) {
            throw new Error(`无上文指代应早退，实际 earlyExit=${earlyExit}`);
        }
        if (decision.intent === "retrieve_and_answer") {
            throw new Error(
                `无上文指代不应 retrieve，intent=${decision.intent} q=${decision.searchQuery}`
            );
        }
    }
);

await assertLive(
    "有上文「那个项目呢？」→ 检索且 searchQuery 含城管/城市管理",
    [
        { role: "user", content: "城管平台用了什么技术" },
        {
            role: "assistant",
            content:
                "城市管理平台前端使用 React、TypeScript、Vite；小程序端使用 UniApp。",
        },
        { role: "user", content: "那个项目呢？" },
    ],
    ({ decision, earlyExit }) => {
        if (earlyExit || decision.intent !== "retrieve_and_answer") {
            throw new Error(
                `期望检索非早退，实际 earlyExit=${earlyExit} intent=${decision.intent}`
            );
        }
        if (!/城管|城市管理|urban|platform/i.test(decision.searchQuery)) {
            throw new Error(`searchQuery 应含项目实体: ${decision.searchQuery}`);
        }
    }
);

await assertLive(
    "追问职责 → 检索且含奥卡云/职责",
    [
        { role: "user", content: "介绍一下西安奥卡云的工作经历" },
        {
            role: "assistant",
            content: "您在西安奥卡云担任前端小组组长，负责城市管理平台等项目。",
        },
        { role: "user", content: "那个阶段主要负责什么？" },
    ],
    ({ decision, earlyExit }) => {
        if (earlyExit || decision.intent !== "retrieve_and_answer") {
            throw new Error(
                `期望 retrieve 非早退，earlyExit=${earlyExit} intent=${decision.intent}`
            );
        }
        const blob = [
            decision.searchQuery,
            ...(decision.retrievalPlan ?? []).flatMap((p) => [
                p.label,
                p.searchQuery,
            ]),
            ...(decision.compositeSlots ?? []).flatMap((s) => [
                s.label,
                s.searchQuery,
            ]),
        ].join(" ");
        if (!/奥卡云|职责|负责|角色|工作经历|西安/.test(blob)) {
            throw new Error(`应含奥卡云/职责/经历线索: ${blob.slice(0, 200)}`);
        }
    }
);

if (process.exitCode) {
    console.log("\nFAILED");
    process.exit(process.exitCode);
}
console.log("\nOK");
