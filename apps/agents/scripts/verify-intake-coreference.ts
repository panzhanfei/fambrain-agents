/**
 * Wave C（QU-02）：Intake 多轮指代 — guard 单测 + Intake live 抽检。
 *
 *   pnpm --filter @fambrain/agents run verify:intake-coreference
 */
import type { DbChatTurn } from "@fambrain/agent-types";
import {
    applyIntakeCoreferenceGuard,
    completeIntakeCoordinator,
    findRepeatAnswerInHistory,
    hasCoreferenceContext,
    isVagueReferentialQuestion,
    type IntakeRoutingDecision,
} from "../src/agentflow/agents/online/intake-coordinator/index.ts";
import { parseIntakeDecision } from "../src/agentflow/pipeline/parse-intake.ts";
import { bootstrapAgentsRuntime } from "../src/config/index.ts";

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

const retrieveStub: IntakeRoutingDecision = {
    intent: "retrieve_and_answer",
    needsRetrieval: true,
    searchQuery: "西安奥卡云 城市管理平台",
    subTasks: [],
    topics: ["project"],
    language: "zh",
    confidence: 0.88,
    queryType: "tech",
    clarifyingQuestion: null,
    briefReply: null,
    retrievalPlan: [],
};

console.log("verify-intake-coreference\n— guard 单测 —");

assertSync("isVagueReferentialQuestion：那个项目呢", () => {
    if (!isVagueReferentialQuestion("那个项目呢？")) {
        throw new Error("应识别为指代问法");
    }
});

assertSync("isVagueReferentialQuestion：城管平台不是 vague", () => {
    if (isVagueReferentialQuestion("城管平台用了什么技术")) {
        throw new Error("含实体不应为 vague");
    }
});

assertSync("guard：单轮指代 → clarify", () => {
    const history: DbChatTurn[] = [{ role: "user", content: "那个项目呢？" }];
    const out = applyIntakeCoreferenceGuard(retrieveStub, history);
    if (out.intent !== "clarify" || out.needsRetrieval) {
        throw new Error(`期望 clarify，实际 ${out.intent}`);
    }
});

assertSync("guard：有上文实体 → 保留 retrieve", () => {
    const history: DbChatTurn[] = [
        { role: "user", content: "城管平台用了什么技术" },
        { role: "assistant", content: "React TypeScript" },
        { role: "user", content: "那个项目呢？" },
    ];
    if (!hasCoreferenceContext(history)) {
        throw new Error("应有 coreference context");
    }
    const out = applyIntakeCoreferenceGuard(retrieveStub, history);
    if (!out.needsRetrieval) {
        throw new Error("有上文应保留 needsRetrieval");
    }
});

console.log("\n— repeat guard 单测 —");

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

await bootstrapAgentsRuntime();

console.log("\n— Intake live + guard —");

const assertLive = async (
    name: string,
    history: DbChatTurn[],
    check: (d: IntakeRoutingDecision) => void
) => {
    try {
        const raw = await completeIntakeCoordinator(history);
        const parsed = parseIntakeDecision(raw);
        if (!parsed) {
            throw new Error(`Intake JSON 解析失败: ${raw.slice(0, 200)}`);
        }
        const decision = applyIntakeCoreferenceGuard(parsed, history);
        check(decision);
        console.log(`  ✓ ${name}`);
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`  ✗ ${name}: ${msg}`);
        process.exitCode = 1;
    }
};

await assertLive(
    "单轮「那个项目呢？」→ clarify",
    [{ role: "user", content: "那个项目呢？" }],
    (d) => {
        if (d.intent !== "clarify" || d.needsRetrieval) {
            throw new Error(
                `期望 clarify，实际 intent=${d.intent} needsRetrieval=${d.needsRetrieval}`
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
    (d) => {
        if (!d.needsRetrieval || d.intent === "clarify") {
            throw new Error(`期望检索，实际 intent=${d.intent}`);
        }
        if (!/城管|城市管理|urban|platform/i.test(d.searchQuery)) {
            throw new Error(`searchQuery 应含项目实体: ${d.searchQuery}`);
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
    (d) => {
        if (!d.needsRetrieval) {
            throw new Error(`期望 needsRetrieval=true`);
        }
        if (!/奥卡云|职责|负责|角色/.test(d.searchQuery)) {
            throw new Error(`searchQuery: ${d.searchQuery}`);
        }
    }
);

if (process.exitCode) {
    console.log("\nFAILED");
    process.exit(process.exitCode);
}
console.log("\nOK");
