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
    parseIntakeDecision,
    runIntakePipeline,
} from "../src/agentflow/brain-service/online/intake-coordinator/index";
import { findRepeatAnswerInHistory } from "../src/agentflow/brain-service/online/intake-coordinator";
import { bootstrapBrainServiceRuntime } from "../src/config/index";
import { enableRepeatGuardForVerify } from "./verify-test-env";

const assertSync = (name: string, fn: () => void) => {
    try {
        fn();
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

console.log("verify-intake-coreference\n— pipeline 单测（LLM JSON 透传） —");

assertSync("isClarifyEarlyExit：clarify + 反问", () => {
    const parsed = parseIntakeDecision(clarifyJson);
    if (!parsed || !isClarifyEarlyExit(parsed)) {
        throw new Error("应识别为 clarify 早退");
    }
});

assertSync("pipeline：LLM clarify → earlyExit", () => {
    const history: DbChatTurn[] = [{ role: "user", content: "那个项目呢？" }];
    const { decision, earlyExit } = runIntakePipeline({
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

assertSync("pipeline：LLM retrieve 含实体 → 非早退", () => {
    const history: DbChatTurn[] = [
        { role: "user", content: "城管平台用了什么技术" },
        { role: "assistant", content: "React TypeScript" },
        { role: "user", content: "那个项目呢？" },
    ];
    const { decision, earlyExit } = runIntakePipeline({
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

assertSync("pipeline：多问 retrieve → composite", () => {
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
    const { decision, earlyExit } = runIntakePipeline({
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

assertSync("repeat：同句再问命中 history 答", () => {
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

assertSync("repeat：标点差异仍命中", () => {
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

assertSync("repeat：首次提问不命中", () => {
    const hit = findRepeatAnswerInHistory(
        [{ role: "user", content: "你好" }],
        "你好"
    );
    if (hit) throw new Error("首次问不应命中");
});

assertSync("repeat：REPEAT_QUESTION_CACHE_DISABLED=1 时不命中", () => {
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

console.log("\n— Intake live + pipeline —");

const assertLive = async (
    name: string,
    history: DbChatTurn[],
    check: (result: ReturnType<typeof runIntakePipeline>) => void
) => {
    try {
        const lastUser =
            [...history].reverse().find((t) => t.role === "user")?.content ??
            "";
        const raw = await completeIntakeCoordinator(history);
        const result = runIntakePipeline({
            intakeRaw: raw,
            userQuestion: lastUser,
            intakeHistory: history,
        });
        check(result);
        console.log(`  ✓ ${name}`);
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`  ✗ ${name}: ${msg}`);
        process.exitCode = 1;
    }
};

await assertLive(
    "单轮「那个项目呢？」→ clarify + pipeline 早退",
    [{ role: "user", content: "那个项目呢？" }],
    ({ decision, earlyExit }) => {
        if (!earlyExit || decision.intent !== "clarify") {
            throw new Error(
                `期望 clarify+earlyExit，实际 earlyExit=${earlyExit} intent=${decision.intent}`
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
        if (!/奥卡云|职责|负责|角色/.test(decision.searchQuery)) {
            throw new Error(`searchQuery: ${decision.searchQuery}`);
        }
    }
);

if (process.exitCode) {
    console.log("\nFAILED");
    process.exit(process.exitCode);
}
console.log("\nOK");
