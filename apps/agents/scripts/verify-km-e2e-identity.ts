/**
 * KM-10/11 全链路 spot check：「我的名字是什么？」
 *
 *   pnpm --filter @fambrain/agents exec tsx --env-file=../../.env scripts/verify-km-e2e-identity.ts
 */
import type { AgentPipelineContext, DbChatTurn } from "@fambrain/agent-types";
import { listCorpusUserIds } from "@/agentflow/agents/offline/knowledge-indexer/list-corpus-users";
import { runPipelineStream } from "@/agentflow/index";
import { bootstrapAgentsRuntime } from "@/config";

const main = async (): Promise<void> => {
    bootstrapAgentsRuntime();
    const ids = await listCorpusUserIds();
    const corpusUserId =
        process.env.FAMBRAIN_CORPUS_USER_ID?.trim() || ids[0];
    if (!corpusUserId) throw new Error("无 corpus 用户");

    const question = "我的名字是什么？";
    const steps: string[] = [];
    let answer = "";
    const history: DbChatTurn[] = [{ role: "user", content: question }];
    const context: AgentPipelineContext = {
        actorUserId: corpusUserId,
        corpusUserId,
        displayName: "E2E",
        conversationId: `e2e-km10-11-${Date.now()}`,
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
    console.log("answer:", answer.slice(0, 400));

    const issues: string[] = [];
    if (!steps.includes("retrieval")) issues.push("应进入 retrieval");
    if (!steps.includes("fact_checker")) issues.push("应进入 fact_checker");
    if (steps.filter((s) => s === "retrieval").length !== 1) {
        issues.push("不应二次 KM");
    }
    if (!answer.includes("潘展飞")) issues.push("回答应含「潘展飞」");

    if (issues.length) {
        console.log("❌", issues.join("; "));
        process.exit(1);
    }
    console.log("✅ E2E OK");
};

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
