/**
 * FactChecker 全链路冒烟：runPipelineStream，观察 step 与是否二次检索。
 *
 *   pnpm exec tsx --env-file=../../.env scripts/verify-fact-checker-pipeline.ts
 */
import { runPipelineStream } from "../src/agentflow/index.ts";
const context = {
    actorUserId: "verify-fact-checker",
    corpusUserId: "verify-fact-checker",
    displayName: "验证用户",
    conversationId: "verify-fact-checker-conv",
};
const runCase = async (label: string, userQuestion: string) => {
    const steps: string[] = [];
    let answer = "";
    let error: string | undefined;
    const gen = runPipelineStream([{ role: "user", content: userQuestion }], context);
    while (true) {
        const next = await gen.next();
        if (next.done) {
            answer = next.value.answer;
            break;
        }
        const ev = next.value;
        if (ev.type === "step" && ev.status === "running") {
            steps.push(ev.name);
        }
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
const main = async () => {
    console.log("Pipeline 冒烟（需 Ollama；语料可为空）\n");
    const chitchat = await runCase("G1 闲聊", "你好");
    const retrieve = await runCase("检索 + 核查", "城管平台用了什么技术？");
    const okChitchat = !chitchat.steps.includes("retrieval") &&
        !chitchat.steps.includes("fact_checker");
    const okRetrieve = chitchat.steps.includes("intake") &&
        retrieve.steps.includes("retrieval") &&
        retrieve.steps.includes("fact_checker") &&
        retrieve.steps.includes("content_organizer") &&
        retrieve.steps.includes("analyst");
    const retrievalCount = retrieve.steps.filter((s) => s === "retrieval").length;
    console.log("\n--- 断言 ---");
    console.log(`G1 不检索/不核查: ${okChitchat ? "OK" : "FAIL"}`);
    console.log(`检索链路含 fact_checker + content_organizer: ${okRetrieve ? "OK" : "FAIL"} (retrieval 出现 ${retrievalCount} 次)`);
    if (!okChitchat || !okRetrieve)
        process.exit(1);
    console.log("\nPipeline 冒烟通过。");
};
main().catch((e) => {
    console.error(e);
    process.exit(1);
});
