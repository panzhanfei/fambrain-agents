import { createRedisConnection } from "../redis/client";
import { getInfraConfig } from "../config";
import type { PipelineJobStreamEvent } from "./job-types";

export const pipelineEventChannel = (jobId: string): string => {
    const { eventChannelPrefix } = getInfraConfig().pipelineQueue;
    return `${eventChannelPrefix}:${jobId}`;
};

export const publishPipelineEvent = async (
    jobId: string,
    event: PipelineJobStreamEvent
): Promise<void> => {
    const redis = createRedisConnection();
    try {
        await redis.publish(pipelineEventChannel(jobId), JSON.stringify(event));
    } finally {
        redis.disconnect();
    }
};

export const subscribePipelineEvents = (
    jobId: string,
    onEvent: (event: PipelineJobStreamEvent) => void
): (() => void) => {
    const redis = createRedisConnection();
    const channel = pipelineEventChannel(jobId);
    void redis.subscribe(channel);
    redis.on("message", (_ch, message) => {
        try {
            onEvent(JSON.parse(message) as PipelineJobStreamEvent);
        } catch {
            /* ignore malformed */
        }
    });
    return () => {
        void redis.unsubscribe(channel);
        redis.disconnect();
    };
};
