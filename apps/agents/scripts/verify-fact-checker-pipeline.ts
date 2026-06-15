/**
 * FactChecker 全链路冒烟：runPipelineStream，观察 step 与是否二次检索。
 * 轻量开发自测；正式回归请用 `pnpm run golden:regression`。
 *
 *   pnpm run verify:fact-checker:pipeline
 */
import type { AgentPipelineContext, DbChatTurn } from "@fambrain/agent-types";
import { runPipelineStream } from "@/agentflow/index";
import { bootstrapAgentsRuntime } from "@/config";

const context: AgentPipelineContext = {
    actorUserId: "verify-fact-checker",
    corpusUserId: "verify-fact-checker",
    displayName: "验证用户",
    conversationId: "verify-fact-checker-conv",
};

const runCase = async (label: string, userQuestion: string) => {
    const steps: string[] = [];
    let answer = "";
    let error: string | undefined;
    const history: DbChatTurn[] = [{ role: "user", content: userQuestion }];
    const gen = runPipelineStream(history, context);
    while (true) {
        const next = await gen.next();
        if (next.done) {
            answer = next.value.answer;
            break;
        }
        const ev = next.value;
        if (ev.type === "step" && ev.status === "running")
            steps.push(ev.name);
        if (ev.type === "error")
            error = ev.message;
    }
    console.log(`\n=== ${label} ===`);
    console.log(`问：${userQuestion}`);
    console.log(`steps: ${steps.join(" → ") || "(无)"}`);
    if (error)
        console.log(`error: ${error}`);
    console.log(`答：${answer.slice(0, 200)}${answer.length > 200 ? "…" : ""}`);
    return { steps, answer, error };
};

const main = async (): Promise<void> => {
    bootstrapAgentsRuntime();
    console.log("FactChecker 全链路冒烟（需 Ollama；语料可为空）\n");
    const chitchat = await runCase("G1 闲聊", "你好");
    const retrieve = await runCase("检索 + 核查", "城管平台用了什么技术？");
    const okChitchat = !chitchat.steps.includes("retrieval")
        && !chitchat.steps.includes("fact_checker");
    const okRetrieve = retrieve.steps.includes("intake")
        && retrieve.steps.includes("retrieval")
        && retrieve.steps.includes("fact_checker")
        && retrieve.steps.includes("content_organizer")
        && retrieve.steps.includes("analyst");
    const retrievalCount = retrieve.steps.filter((s) => s === "retrieval").length;
    console.log("\n--- 断言 ---");
    console.log(`G1 不检索/不核查: ${okChitchat ? "OK" : "FAIL"}`);
    console.log(`检索链路含 fact_checker + content_organizer: ${okRetrieve ? "OK" : "FAIL"} (retrieval 出现 ${retrievalCount} 次)`);
    if (!okChitchat || !okRetrieve)
        process.exit(1);
    console.log("\nPipeline 冒烟通过。");
};

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
