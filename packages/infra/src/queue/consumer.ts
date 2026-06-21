import { Worker, type Job } from "bullmq";
import { getInfraConfig } from "../config";
import { createRedisConnection } from "../redis/client";
import { publishPipelineEvent } from "./events";
import type { PipelineJobPayload, PipelineJobResult } from "./job-types";

export type PipelineJobHandler = (
    payload: PipelineJobPayload,
    emit: (event: import("./job-types").PipelineJobStreamEvent) => Promise<void>
) => Promise<PipelineJobResult>;

let worker: Worker<PipelineJobPayload, PipelineJobResult> | null = null;

export const startPipelineWorker = (
    handler: PipelineJobHandler
): Worker<PipelineJobPayload, PipelineJobResult> => {
    const cfg = getInfraConfig();
    if (!cfg.redisUrl) {
        throw new Error("Redis 未配置，无法启动 pipeline worker");
    }
    if (worker) return worker;

    worker = new Worker<PipelineJobPayload, PipelineJobResult>(
        cfg.pipelineQueue.name,
        async (job: Job<PipelineJobPayload>) => {
            const jobId = job.id ?? "unknown";
            const emit = async (
                event: import("./job-types").PipelineJobStreamEvent
            ) => {
                await publishPipelineEvent(jobId, event);
            };
            const result = await handler(job.data, emit);
            await emit({
                type: "pipeline_done",
                answer: result.answer,
                retrievalCacheHit: result.retrievalCacheHit,
            });
            return result;
        },
        {
            connection: createRedisConnection(),
            concurrency: cfg.pipelineQueue.concurrency,
        }
    );

    worker.on("failed", (job, err) => {
        const jobId = job?.id ?? "unknown";
        void publishPipelineEvent(jobId, {
            type: "error",
            message: err instanceof Error ? err.message : String(err),
        });
    });

    return worker;
};

export const stopPipelineWorker = async (): Promise<void> => {
    if (!worker) return;
    await worker.close();
    worker = null;
};
