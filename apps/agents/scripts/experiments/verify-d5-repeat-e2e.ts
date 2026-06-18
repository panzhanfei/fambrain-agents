/**
 * D5-2 + R6-3 抽检：同会话重复综合问 + 编号子问公司数。
 *
 *   pnpm --filter @fambrain/agents exec tsx --env-file=../../.env scripts/experiments/verify-d5-repeat-e2e.ts
 */
import type { AgentPipelineContext, DbChatTurn } from "@fambrain/agent-types";
import { listCorpusUserIds } from "@/agentflow/agents/offline/knowledge-indexer/list-corpus-users";
import { runPipelineStream } from "@/agentflow/index";
import { bootstrapAgentsRuntime } from "@/config";

const COMPOSITE =
    "我叫什么，我做过什么项目，我在那几家公司上过班，近两年在干什么？";
const SUB_ENUM = "我在哪几家公司上过班？";

const COMPANIES = ["云联智慧", "友谊时光", "奖多多", "奥卡云"];

type TurnResult = {
    steps: string[];
    answer: string;
    cacheHit: boolean;
    repeatHit: boolean;
    latencyMs: number;
    companiesFound: string[];
};

const runTurn = async (
    corpusUserId: string,
    conversationId: string,
    history: DbChatTurn[]
): Promise<{ result: TurnResult; history: DbChatTurn[] }> => {
    const started = Date.now();
    const steps: string[] = [];
    let answer = "";
    let cacheHit = false;
    let repeatHit = false;
    const context: AgentPipelineContext = {
        actorUserId: corpusUserId,
        corpusUserId,
        displayName: "D5-Repeat-E2E",
        conversationId,
    };
    const gen = runPipelineStream(history, context);
    while (true) {
        const next = await gen.next();
        if (next.done) {
            answer = next.value.answer;
            if (next.value.retrievalCacheHit) cacheHit = true;
            if (next.value.repeatQuestionHit) repeatHit = true;
            break;
        }
        const ev = next.value;
        if (ev.type === "step" && ev.status === "running") steps.push(ev.name);
        if (ev.type === "retrieval_meta" && ev.cacheHit) cacheHit = true;
    }
    const companiesFound = COMPANIES.filter((c) => answer.includes(c));
    const result: TurnResult = {
        steps,
        answer,
        cacheHit,
        repeatHit,
        latencyMs: Date.now() - started,
        companiesFound,
    };
    const nextHistory: DbChatTurn[] = [
        ...history,
        { role: "assistant", content: answer },
    ];
    return { result, history: nextHistory };
};

const fail = (msg: string) => {
    console.error(`  ✗ ${msg}`);
    process.exitCode = 1;
};

const ok = (msg: string) => console.log(`  ✓ ${msg}`);

await bootstrapAgentsRuntime();
const corpusUserId =
    process.env.FAMBRAIN_CORPUS_USER_ID?.trim() ||
    (await listCorpusUserIds())[0];
if (!corpusUserId) {
    console.error("无 corpus 用户");
    process.exit(1);
}

console.log(`verify-d5-repeat-e2e (corpus=${corpusUserId})\n`);

const conversationId = `d5-repeat-${Date.now()}`;
let history: DbChatTurn[] = [{ role: "user", content: COMPOSITE }];

console.log("— Turn 1：综合问 —");
const t1 = await runTurn(corpusUserId, conversationId, history);
history = [
    ...t1.history.slice(0, -1),
    { role: "user", content: COMPOSITE },
    { role: "assistant", content: t1.result.answer },
];
console.log(
    `  steps=[${t1.result.steps.join(",")}] repeat=${t1.result.repeatHit} cache=${t1.result.cacheHit} ${t1.result.latencyMs}ms companies=${t1.result.companiesFound.length}/4`
);
if (t1.result.companiesFound.length >= 3) {
    ok(`Turn1 公司 ${t1.result.companiesFound.join("、")}`);
} else {
    fail(
        `Turn1 公司不足（${t1.result.companiesFound.length}/4）: ${t1.result.companiesFound.join("、") || "无"}`
    );
}

console.log("\n— Turn 2：同问重复 —");
history.push({ role: "user", content: COMPOSITE });
const t2 = await runTurn(corpusUserId, conversationId, history);
console.log(
    `  steps=[${t2.result.steps.join(",")}] repeat=${t2.result.repeatHit} cache=${t2.result.cacheHit} ${t2.result.latencyMs}ms companies=${t2.result.companiesFound.length}/4`
);
if (t2.result.repeatHit) {
    ok("Turn2 repeatQuestionHit（入口短路）");
} else {
    fail("Turn2 未命中 repeat guard（D5-2 期望 repeatQuestionHit）");
}
if (t2.result.companiesFound.length >= 3) {
    ok(`Turn2 公司 ${t2.result.companiesFound.join("、")}`);
} else {
    fail(`Turn2 公司退化 R6-3? (${t2.result.companiesFound.length}/4)`);
}

console.log("\n— Turn 3：列举子问 —");
history = [
    ...t2.history.slice(0, -1),
    { role: "user", content: COMPOSITE },
    { role: "assistant", content: t2.result.answer },
    { role: "user", content: SUB_ENUM },
];
const t3 = await runTurn(corpusUserId, conversationId, history);
console.log(
    `  steps=[${t3.result.steps.join(",")}] repeat=${t3.result.repeatHit} cache=${t3.result.cacheHit} ${t3.result.latencyMs}ms companies=${t3.result.companiesFound.length}/4`
);
if (t3.result.companiesFound.length === 4) {
    ok(`Turn3 四家齐全: ${t3.result.companiesFound.join("、")}`);
} else if (t3.result.companiesFound.length >= 3) {
    console.log(
        `  ⚠ Turn3 仅 ${t3.result.companiesFound.length}/4: ${t3.result.companiesFound.join("、")}（R6-3 风险）`
    );
} else {
    fail(
        `Turn3 严重退化 (${t3.result.companiesFound.length}/4): ${t3.result.companiesFound.join("、") || "无"}`
    );
}

console.log(
    `\n${process.exitCode ? "FAILED" : "OK"} — latency t1=${t1.result.latencyMs}ms t2=${t2.result.latencyMs}ms t3=${t3.result.latencyMs}ms`
);
if (process.exitCode) process.exit(process.exitCode);
