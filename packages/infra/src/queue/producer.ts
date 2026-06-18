import { Queue } from "bullmq";
import { getInfraConfig } from "../config.ts";
import { createRedisConnection, isRedisConfigured } from "../redis/client.ts";
import type { PipelineJobPayload } from "./job-types.ts";

let queue: Queue<PipelineJobPayload> | null = null;

const getPipelineQueue = (): Queue<PipelineJobPayload> => {
    if (queue) return queue;
    const cfg = getInfraConfig();
    if (!cfg.pipelineQueue.enabled) {
        throw new Error("PIPELINE_QUEUE_ENABLED 未开启");
    }
    queue = new Queue<PipelineJobPayload>(cfg.pipelineQueue.name, {
        connection: createRedisConnection(),
        defaultJobOptions: {
            removeOnComplete: 100,
            removeOnFail: 200,
            attempts: 1,
        },
    });
    return queue;
};

export const isPipelineQueueEnabled = (): boolean => {
    return getInfraConfig().pipelineQueue.enabled && isRedisConfigured();
};

export const enqueuePipelineJob = async (
    payload: PipelineJobPayload
): Promise<{ jobId: string }> => {
    const q = getPipelineQueue();
    const job = await q.add("run-pipeline", payload, {
        jobId: undefined,
    });
    return { jobId: job.id ?? String(job.id) };
};

export const closePipelineQueue = async (): Promise<void> => {
    if (!queue) return;
    await queue.close();
    queue = null;
};
