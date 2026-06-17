import { ensureAgentsRuntime } from "@/config";
import { buildLangGraphRunConfig, } from "@fambrain/agent-config/langsmith";
import { logAgentIn, logAgentOut } from "@fambrain/agent-shared/agent-log";
import type { AgentPipelineContext, AgentPipelineResult, AgentStreamEvent, DbChatTurn, } from "@fambrain/agent-types";
import { getCompiledPipelineGraph } from "./compile";
import type { PipelineGraphState } from "./state";
import {
  persistPipelineMemory,
  preparePipelineMemory,
} from "@fambrain/agent-memory";
type PipelineStepName = "intake" | "retrieval" | "fact_checker" | "content_summarizer" | "content_organizer" | "analyst";
type AnalystStreamChunk = {
    type: "thinking";
    text: string;
} | {
    type: "assistant";
    text: string;
};
const lastUserQuestion = (history: DbChatTurn[]): string => {
    for (let i = history.length - 1; i >= 0; i--) {
        if (history[i].role === "user")
            return history[i].content.trim();
    }
    return "";
};
function* emitAssistant(answer: string): Generator<AgentStreamEvent> {
    yield { type: "assistant", text: answer };
}
const buildInitialState = (history: DbChatTurn[], context: AgentPipelineContext, userQuestion: string, memoryBlock: string | null, intakeHistory: DbChatTurn[]): PipelineGraphState => {
    return {
        history,
        context,
        userQuestion,
        decision: null,
        hits: [],
        coverage: "none",
        notes: null,
        answer: null,
        error: null,
        exitEarly: false,
        checkerPassed: true,
        retryCount: 0,
        memoryBlock,
        intakeHistory,
        confidenceTier: null,
    };
};
const isAnalystStreamChunk = (value: unknown): value is AnalystStreamChunk => {
    if (!value || typeof value !== "object")
        return false;
    const chunk = value as {
        type?: unknown;
        text?: unknown;
    };
    return ((chunk.type === "thinking" || chunk.type === "assistant") &&
        typeof chunk.text === "string");
};
const shouldRetryRetrieval = (state: PipelineGraphState): boolean => {
    return !state.checkerPassed && state.retryCount < 1;
};

const summarizePipelineOut = (state: PipelineGraphState, answer: string) => ({
    answerPreview: answer.length > 400 ? `${answer.slice(0, 400)}…` : answer,
    exitEarly: state.exitEarly,
    intent: state.decision?.intent ?? null,
    needsRetrieval: state.decision?.needsRetrieval ?? null,
    hitCount: state.hits.length,
    coverage: state.coverage,
    checkerPassed: state.checkerPassed,
    retryCount: state.retryCount,
    confidenceTier: state.confidenceTier,
    error: state.error,
    hitPaths: state.hits.map((h) => h.path),
});
/**
 * LangGraph 流式编排：全链路在 graph 内（含 Analyst）；
 * custom 流转发 thinking / assistant，由 pipeline 映射为 AgentStreamEvent。
 */
export async function* runPipelineStream(history: DbChatTurn[], context: AgentPipelineContext): AsyncGenerator<AgentStreamEvent, AgentPipelineResult> {
    ensureAgentsRuntime();
    const userQuestion = lastUserQuestion(history);
    logAgentIn("Pipeline", "进入", {
        userQuestion,
        historyTurns: history.length,
        actorUserId: context.actorUserId,
        corpusUserId: context.corpusUserId,
        displayName: context.displayName,
        conversationId: context.conversationId,
    });
    const memory = await preparePipelineMemory({
        context,
        history,
        userQuestion,
    });
    const graph = getCompiledPipelineGraph();
    const input = buildInitialState(history, context, userQuestion, memory.promptBlock, memory.intakeHistory);
    let finalState: PipelineGraphState = input;
    let activeStep: PipelineStepName | null = "intake";
    yield { type: "step", name: "intake", status: "running" };
    const stream = await graph.stream(input as Parameters<typeof graph.stream>[0], {
        streamMode: ["updates", "values", "custom"],
        ...buildLangGraphRunConfig({
            conversationId: context.conversationId,
            corpusUserId: context.corpusUserId,
            actorUserId: context.actorUserId,
            userQuestion,
        }),
    });
    const finishStep = function* (name: PipelineStepName) {
        if (activeStep === name) {
            yield { type: "step", name, status: "done" } as const;
            activeStep = null;
        }
    };
    const startStep = function* (name: PipelineStepName) {
        if (activeStep !== name) {
            yield { type: "step", name, status: "running" } as const;
            activeStep = name;
        }
    };
    for await (const chunk of stream) {
        const [mode, payload] = chunk as [
            "updates" | "values" | "custom",
            unknown
        ];
        if (mode === "values") {
            finalState = payload as PipelineGraphState;
            continue;
        }
        if (mode === "custom") {
            if (isAnalystStreamChunk(payload)) {
                yield payload;
            }
            continue;
        }
        const update = payload as Record<string, Partial<PipelineGraphState>>;
        const nodeName = Object.keys(update)[0];
        if (!nodeName)
            continue;
        const nodePatch = update[nodeName];
        if (nodePatch) {
            finalState = { ...finalState, ...nodePatch };
        }
        if (nodeName === "intake") {
            yield* finishStep("intake");
            if (finalState.error) {
                yield { type: "error", message: finalState.error };
                const answer = finalState.answer ??
                    "（模型调用失败：请确认本地 Ollama 已启动且模型已拉取）";
                logAgentOut("Pipeline", "出去", summarizePipelineOut(finalState, answer));
                yield* emitAssistant(answer);
                return { answer };
            }
            if (finalState.decision?.needsRetrieval) {
                yield* startStep("retrieval");
            }
            else if (finalState.decision?.intent === "summarize_content") {
                yield* startStep("content_summarizer");
            }
            continue;
        }
        if (nodeName === "retrieval") {
            yield* finishStep("retrieval");
            if (finalState.decision?.intent === "summarize_content") {
                yield* startStep("content_summarizer");
            }
            else {
                yield* startStep("fact_checker");
            }
            if (finalState.error) {
                yield { type: "error", message: finalState.error };
            }
            continue;
        }
        if (nodeName === "contentSummarizer") {
            yield* finishStep("content_summarizer");
            continue;
        }
        if (nodeName === "factChecker") {
            yield* startStep("fact_checker");
            yield* finishStep("fact_checker");
            if (shouldRetryRetrieval(finalState)) {
                yield* startStep("retrieval");
            }
            else {
                yield* startStep("content_organizer");
            }
            continue;
        }
        if (nodeName === "contentOrganizer") {
            yield* finishStep("content_organizer");
            yield* startStep("analyst");
            continue;
        }
        if (nodeName === "analyst") {
            yield* finishStep("analyst");
            if (finalState.error) {
                yield { type: "error", message: finalState.error };
            }
            continue;
        }
        if (nodeName === "respondEarly") {
            if (activeStep) {
                yield {
                    type: "step",
                    name: activeStep,
                    status: "done",
                };
                activeStep = null;
            }
        }
    }
    if (activeStep) {
        yield { type: "step", name: activeStep, status: "done" };
    }
    if (finalState.exitEarly && finalState.answer) {
        logAgentOut("Pipeline", "出去", summarizePipelineOut(finalState, finalState.answer));
        yield* emitAssistant(finalState.answer);
        await persistPipelineMemory({
            context,
            history,
            userQuestion,
            answer: finalState.answer,
        }).catch(() => undefined);
        return { answer: finalState.answer };
    }
    const answer = finalState.answer ??
        "（未能生成回复，请稍后重试）";
    if (!finalState.answer) {
        yield* emitAssistant(answer);
    }
    await persistPipelineMemory({
        context,
        history,
        userQuestion,
        answer,
    }).catch(() => undefined);
    logAgentOut("Pipeline", "出去", summarizePipelineOut(finalState, answer));
    return { answer };
}
