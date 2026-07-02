/**
 * BullMQ pipeline worker：消费队列任务并 pub/sub 推送 SSE 事件。
 *
 *   pnpm --filter @fambrain/agents run dev:worker
 */
import { startPipelineWorker, stopPipelineWorker } from "@fambrain/infra";
import { runPipelineStream } from "@/agentflow/pipeline";
import { bootstrapAgentsRuntime } from "@/config/index";

await bootstrapAgentsRuntime();

console.log("[pipeline-worker] 启动中…");

startPipelineWorker(async (payload, emit) => {
    const gen = runPipelineStream(payload.history, payload.context);
    let result: { answer: string; retrievalCacheHit?: boolean } | undefined;
    while (true) {
        const next = await gen.next();
        if (next.done) {
            result = next.value;
            break;
        }
        const ev = next.value;
        if (ev.type === "step") {
            await emit({
                type: "step",
                name: ev.name,
                status: ev.status,
            });
        } else if (ev.type === "thinking") {
            await emit({ type: "thinking", text: ev.text });
        } else if (ev.type === "assistant") {
            await emit({ type: "assistant", text: ev.text });
        } else if (ev.type === "error") {
            await emit({ type: "error", message: ev.message });
        } else if (ev.type === "retrieval_meta") {
            await emit({ type: "retrieval_meta", cacheHit: ev.cacheHit });
        }
    }
    return {
        answer: result?.answer ?? "",
        retrievalCacheHit: result?.retrievalCacheHit,
    };
});

console.log("[pipeline-worker] 就绪，等待 BullMQ 任务…");

const shutdown = async () => {
    await stopPipelineWorker();
    process.exit(0);
};

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
