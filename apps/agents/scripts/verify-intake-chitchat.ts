/**
 * P0-13：Intake chitchat briefReply — guard 单测 + live 连跑 N 次「你好」。
 *
 *   pnpm --filter @fambrain/agents run verify:intake-chitchat
 *   CHITCHAT_RUNS=10 pnpm --filter @fambrain/agents run verify:intake-chitchat
 */
import type { DbChatTurn } from "@fambrain/agent-types";
import {
    applyIntakeChitchatGuard,
    completeIntakeCoordinator,
    DEFAULT_CHITCHAT_BRIEF_REPLY,
    isAcceptableChitchatBriefReply,
    type IntakeRoutingDecision,
} from "../src/agentflow/agents/online/intake-coordinator/index.ts";
import { parseIntakeDecision } from "../src/agentflow/pipeline/parse-intake.ts";
import { bootstrapAgentsRuntime } from "../src/config/index.ts";

const DEFAULT_RUNS = 10;

const FORBIDDEN_ANSWER_RE =
    /大表哥|表哥|老铁|宝子|亲爱的|昵称|南起|赵一|陈明/i;

const parseRuns = (): number => {
    const raw = process.env.CHITCHAT_RUNS?.trim() ?? String(DEFAULT_RUNS);
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 1)
        throw new Error(`CHITCHAT_RUNS 须为正整数，当前: ${raw}`);
    return n;
};

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

const chitchatStub = (
    briefReply: string | null
): IntakeRoutingDecision => ({
    intent: "chitchat",
    needsRetrieval: false,
    searchQuery: "",
    subTasks: [],
    topics: [],
    language: "zh",
    confidence: 0.98,
    queryType: null,
    clarifyingQuestion: null,
    briefReply,
});

console.log("verify-intake-chitchat\n— guard 单测 —");

assertSync("isAcceptable：标准 FamBrain 话术", () => {
    if (!isAcceptableChitchatBriefReply(DEFAULT_CHITCHAT_BRIEF_REPLY)) {
        throw new Error("标准模板应通过");
    }
});

assertSync("isAcceptable：大表哥 不通过", () => {
    if (
        isAcceptableChitchatBriefReply(
            "你好，大表哥！有什么可以帮你的？"
        )
    ) {
        throw new Error("应拒绝大表哥");
    }
});

assertSync("guard：大表哥 → 模板", () => {
    const out = applyIntakeChitchatGuard(
        chitchatStub("你好，大表哥，我是助手。")
    );
    if (out.briefReply !== DEFAULT_CHITCHAT_BRIEF_REPLY) {
        throw new Error(`期望模板，实际: ${out.briefReply}`);
    }
});

assertSync("guard：null briefReply → 模板", () => {
    const out = applyIntakeChitchatGuard(chitchatStub(null));
    if (out.briefReply !== DEFAULT_CHITCHAT_BRIEF_REPLY) {
        throw new Error(`期望模板，实际: ${out.briefReply}`);
    }
});

assertSync("guard：非 chitchat 不改动", () => {
    const retrieve: IntakeRoutingDecision = {
        ...chitchatStub(null),
        intent: "retrieve_and_answer",
        needsRetrieval: true,
        searchQuery: "姓名",
        queryType: "identity",
    };
    const out = applyIntakeChitchatGuard(retrieve);
    if (out.briefReply !== null) {
        throw new Error("retrieve 不应被 chitchat guard 改写");
    }
});

await bootstrapAgentsRuntime();

const runs = parseRuns();
console.log(`\n— Intake live × ${runs}（「你好」）—`);

const history: DbChatTurn[] = [{ role: "user", content: "你好" }];

for (let i = 1; i <= runs; i++) {
    try {
        const raw = await completeIntakeCoordinator(history);
        const parsed = parseIntakeDecision(raw);
        if (!parsed) {
            throw new Error(`JSON 解析失败: ${raw.slice(0, 200)}`);
        }
        const decision = applyIntakeChitchatGuard(parsed);
        const reply = decision.briefReply ?? "";
        if (decision.intent !== "chitchat") {
            throw new Error(`期望 chitchat，实际 ${decision.intent}`);
        }
        if (decision.needsRetrieval) {
            throw new Error("chitchat 不应 needsRetrieval");
        }
        if (!isAcceptableChitchatBriefReply(reply)) {
            throw new Error(`guard 后仍不合格: ${reply}`);
        }
        if (FORBIDDEN_ANSWER_RE.test(reply)) {
            throw new Error(`含禁用称呼: ${reply}`);
        }
        console.log(`  ✓ run ${i}/${runs}: ${reply.slice(0, 48)}…`);
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`  ✗ run ${i}/${runs}: ${msg}`);
        process.exitCode = 1;
    }
}

if (process.exitCode) {
    console.log("\nFAILED");
    process.exit(process.exitCode);
}
console.log(`\nOK (${runs}/${runs})`);
