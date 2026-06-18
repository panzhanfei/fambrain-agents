import type { PipelineStepName, PipelineTiming } from "@fambrain/agent-types";

export class PipelineTimingTracker {
    private readonly startedAt = performance.now();
    private ttftMs: number | null = null;
    private readonly nodeStartedAt = new Map<PipelineStepName, number>();
    private readonly nodes: Partial<Record<PipelineStepName, number>> = {};

    markNodeStart(name: PipelineStepName): void {
        this.nodeStartedAt.set(name, performance.now());
    }

    markNodeEnd(name: PipelineStepName): number | undefined {
        const start = this.nodeStartedAt.get(name);
        if (start == null) return undefined;
        const ms = Math.round(performance.now() - start);
        this.nodes[name] = ms;
        this.nodeStartedAt.delete(name);
        return ms;
    }

    markFirstToken(): void {
        if (this.ttftMs === null) {
            this.ttftMs = Math.round(performance.now() - this.startedAt);
        }
    }

    snapshot(): PipelineTiming {
        return {
            totalMs: Math.round(performance.now() - this.startedAt),
            ttftMs: this.ttftMs,
            nodes: { ...this.nodes },
        };
    }
}
