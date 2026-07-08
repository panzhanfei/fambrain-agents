/**
 * P0-13：Intake chitchat — 服务端固定 briefReply + live 连跑 N 次「你好」。
 *
 *   pnpm --filter @fambrain/brain-service run verify:intake-chitchat
 *   CHITCHAT_RUNS=10 pnpm --filter @fambrain/brain-service run verify:intake-chitchat
 */
import type { DbChatTurn } from "@fambrain/brain-types";
import {
    applyIntakeChitchatGuard,
    completeIntakeCoordinator,
    DEFAULT_CHITCHAT_BRIEF_REPLY,
    runIntakePipeline,
    type IntakeRoutingDecision,
} from "../src/agentflow/brain-service/online/intake-coordinator/index";
import { bootstrapBrainServiceRuntime } from "../src/config/index";

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
    retrievalPlan: [],
});

console.log("verify-intake-chitchat\n— guard 单测 —");

assertSync("guard：LLM 大表哥 → 固定模板", () => {
    const out = applyIntakeChitchatGuard(
        chitchatStub("你好，大表哥，我是助手。")
    );
    if (out.briefReply !== DEFAULT_CHITCHAT_BRIEF_REPLY) {
        throw new Error(`期望模板，实际: ${out.briefReply}`);
    }
});

assertSync("guard：null briefReply → 固定模板", () => {
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

await bootstrapBrainServiceRuntime();

const runs = parseRuns();
console.log(`\n— Intake live × ${runs}（「你好」）—`);

const history: DbChatTurn[] = [{ role: "user", content: "你好" }];

for (let i = 1; i <= runs; i++) {
    try {
        const raw = await completeIntakeCoordinator(history);
        const { decision, earlyExit } = runIntakePipeline({
            intakeRaw: raw,
            userQuestion: "你好",
            intakeHistory: history,
        });
        const reply = decision.briefReply ?? "";
        if (decision.intent !== "chitchat") {
            throw new Error(`期望 chitchat，实际 ${decision.intent}`);
        }
        if (!earlyExit) {
            throw new Error("chitchat 应 pipeline 早退");
        }
        if (decision.needsRetrieval) {
            throw new Error("chitchat 不应 needsRetrieval");
        }
        if (reply !== DEFAULT_CHITCHAT_BRIEF_REPLY) {
            throw new Error(`期望固定模板，实际: ${reply}`);
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
