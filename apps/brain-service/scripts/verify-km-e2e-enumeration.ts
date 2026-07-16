/**
 * KM-13～15 全链路 spot check：「我在哪几家公司上过班？」
 *
 *   pnpm --filter @fambrain/brain-service exec tsx --env-file=../../.env scripts/verify-km-e2e-enumeration.ts
 */
import type { AgentPipelineContext, DbChatTurn } from "@fambrain/brain-types";
import { listCorpusUserIds } from "@/agentflow/agents/offline/knowledge-indexer/list-corpus-users";
import { runPipelineStream } from "@/agentflow/index";
import { bootstrapBrainServiceRuntime } from "@/config";

const COMPANIES = ["云联智慧", "友谊时光", "奖多多", "奥卡云"];

const main = async (): Promise<void> => {
    bootstrapBrainServiceRuntime();
    const ids = await listCorpusUserIds();
    const corpusUserId =
        process.env.FAMBRAIN_CORPUS_USER_ID?.trim() || ids[0];
    if (!corpusUserId) throw new Error("无 corpus 用户");

    const question = "我在哪几家公司上过班？";
    const steps: string[] = [];
    let answer = "";
    const history: DbChatTurn[] = [{ role: "user", content: question }];
    const context: AgentPipelineContext = {
        actorUserId: corpusUserId,
        corpusUserId,
        displayName: "E2E",
        conversationId: `e2e-km13-15-${Date.now()}`,
    };

    const gen = runPipelineStream(history, context);
    while (true) {
        const next = await gen.next();
        if (next.done) {
            answer = next.value.answer;
            break;
        }
        const ev = next.value;
        if (ev.type === "step" && ev.status === "running") steps.push(ev.name);
    }

    console.log("Q:", question);
    console.log("corpusUserId:", corpusUserId);
    console.log("steps:", steps.join(" → ") || "(无)");
    console.log("answer:", answer.slice(0, 500));

    const issues: string[] = [];
    if (!steps.includes("retrieval")) issues.push("应进入 retrieval");
    if (!steps.includes("analyst")) issues.push("应进入 analyst");
    const matched = COMPANIES.filter((c) => answer.includes(c));
    if (matched.length < 3) {
        issues.push(`answer 应提及至少 3 家公司，实际 ${matched.length}: ${matched.join("、")}`);
    }
    if (steps.filter((s) => s === "retrieval").length !== 1) {
        issues.push("不应二次 KM");
    }

    if (issues.length) {
        console.log("❌", issues.join("; "));
        process.exit(1);
    }
    console.log("✅ E2E OK（提及:", matched.join("、"), "）");
};

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
