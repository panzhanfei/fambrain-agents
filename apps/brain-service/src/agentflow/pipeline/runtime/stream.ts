/**
 * Pipeline 在线编排 SSE 壳（LangGraph 消费 + 耗时统计）。
 *
 * 职责划分：
 * - graph/：LangGraph 状态、路由、节点注册（compile.ts）
 * - agents/online/*：各节点业务实现
 * - 本目录：SSE 事件、步骤耗时、Pipeline 出去日志
 *
 * 对外入口：runPipelineStream()，由 HTTP routes / eval / golden 调用。
 */
import { ensureBrainServiceRuntime } from "@/config";
import { buildLangGraphRunConfig } from "@fambrain/brain-config/langsmith";
import { logAgentOut } from "@fambrain/brain-shared/agent-log";
import type {
  AgentPipelineContext,
  AgentPipelineResult,
  AgentStreamEvent,
  DbChatTurn,
  PipelineStepName,
  PipelineTiming,
} from "@fambrain/brain-types";
import {
  drainPipelineLogQueue,
  pipelineRunStorage,
  setPipelineActiveNode,
} from "@fambrain/brain-shared/pipeline-run-context";
import { getCompiledPipelineGraph } from "../graph/compile";
import type { PipelineGraphState } from "../graph/state";
import { buildInitialState, lastUserQuestion } from "./initial-state";
import { PipelineTimingTracker } from "./pipeline-timing";

/** Analyst 经 LangGraph custom 通道推送的流式 chunk 形状 */
type AnalystStreamChunk =
  | {
      type: "thinking";
      text: string;
    }
  | {
      type: "assistant";
      text: string;
    };

/** 向 SSE 推送一条 assistant 终稿/流式文本事件 */
function* emitAssistant(answer: string): Generator<AgentStreamEvent> {
  yield { type: "assistant", text: answer };
}

/** 类型守卫：判断 LangGraph custom 流 payload 是否为 Analyst 的 thinking/assistant chunk */
const isAnalystStreamChunk = (value: unknown): value is AnalystStreamChunk => {
  if (!value || typeof value !== "object") return false;
  const chunk = value as {
    type?: unknown;
    text?: unknown;
  };
  return (
    (chunk.type === "thinking" || chunk.type === "assistant") &&
    typeof chunk.text === "string"
  );
};

/** 从 finalState.hits 提取去重后的 corpus path，供 AgentPipelineResult */
const retrievalPathsFromState = (state: PipelineGraphState): string[] => {
  const paths = state.hits
    .map((h) => h.path?.trim())
    .filter((p): p is string => Boolean(p));
  return [...new Set(paths)];
};

/** FactChecker 打回且尚未 retry 时，stream 层需再 yield retrieval step */
const shouldRetryRetrieval = (state: PipelineGraphState): boolean => {
  return !state.checkerPassed && state.retryCount < 1;
};

/** 组装 Pipeline「出去」日志与调试用的结构化摘要（intent、hits、route、timing 等） */
const summarizePipelineOut = (
  state: PipelineGraphState,
  answer: string,
  timing: PipelineTiming
) => ({
  answerPreview: answer.length > 400 ? `${answer.slice(0, 400)}…` : answer,
  exitEarly: state.exitEarly,
  intent: state.decision?.intent ?? null,
  needsRetrieval: state.decision?.needsRetrieval ?? null,
  hitCount: state.hits.length,
  coverage: state.coverage,
  checkerPassed: state.checkerPassed,
  retryCount: state.retryCount,
  confidenceTier: state.confidenceTier,
  repeatQuestionHit: state.repeatQuestionHit,
  retrievalCacheHit: state.retrievalCacheHit,
  retrievalCacheSlotHits: state.retrievalCacheSlotHits,
  routeMode: state.decision?.routeMode ?? null,
  routeReason: state.decision?.routeReason ?? null,
  routePlanSource: state.decision?.routePlanSource ?? null,
  retrievalPlanGuardReason:
    (state.decision as { retrievalPlanGuardReason?: string } | null)
      ?.retrievalPlanGuardReason ?? null,
  compositeSlotCount: state.compositeSubResults?.length ?? 0,
  compositeFacetCacheHits: state.compositeFacetCacheHits ?? null,
  error: state.error,
  hitPaths: state.hits.map((h) => h.path),
  timing,
});

/**
 * 本轮 Pipeline 收尾：刷剩余 pipeline_log → 合并 token 统计 → yield pipeline_timing。
 * 返回最终 PipelineTiming 供 AgentPipelineResult 与「出去」日志使用。
 */
const finishPipeline = function* (
  timing: PipelineTimingTracker
): Generator<AgentStreamEvent, PipelineTiming> {
  yield* flushPipelineLogs();
  const tokenTracker = pipelineRunStorage.getStore()?.tokenTracker;
  const snapshot: PipelineTiming = {
    ...timing.snapshot(),
    ...(tokenTracker ? { tokens: tokenTracker.snapshot() } : {}),
  };
  yield { type: "pipeline_timing", timing: snapshot };
  return snapshot;
};

/** 把 AsyncLocalStorage 队列里积压的 Agent 日志批量 yield 为 pipeline_log SSE 事件 */
function* flushPipelineLogs(): Generator<AgentStreamEvent> {
  for (const entry of drainPipelineLogQueue()) {
    yield { type: "pipeline_log", entry };
  }
}

/** 在线 Pipeline 对外入口 */
export async function* runPipelineStream(
  history: DbChatTurn[],
  context: AgentPipelineContext
): AsyncGenerator<AgentStreamEvent, AgentPipelineResult> {
  return yield* runPipelineStreamInner(history, context);
}

/**
 * Pipeline 主流程：LangGraph stream 消费循环。
 * 业务节点在 agents/online/*；图拓扑在 graph/compile.ts。
 */
async function* runPipelineStreamInner(
  history: DbChatTurn[],
  context: AgentPipelineContext
): AsyncGenerator<AgentStreamEvent, AgentPipelineResult> {
  ensureBrainServiceRuntime();
  const userQuestion = lastUserQuestion(history);
  const timing = new PipelineTimingTracker();
  const graph = getCompiledPipelineGraph();
  const input = buildInitialState(history, context, userQuestion);
  let finalState: PipelineGraphState = input;
  let activeStep: PipelineStepName | null = "prepare_turn_start";
  timing.markNodeStart("prepare_turn_start");
  setPipelineActiveNode("prepare_turn_start");
  yield { type: "step", name: "prepare_turn_start", status: "running" };
  const stream = await graph.stream(
    input as Parameters<typeof graph.stream>[0],
    {
      streamMode: ["updates", "values", "custom"],
      ...buildLangGraphRunConfig({
        conversationId: context.conversationId,
        corpusUserId: context.corpusUserId,
        actorUserId: context.actorUserId,
        userQuestion,
      }),
    }
  );
  /** 结束当前 activeStep：记耗时、yield step done、刷 pipeline_log */
  const finishStep = function* (name: PipelineStepName) {
    if (activeStep === name) {
      const durationMs = timing.markNodeEnd(name);
      setPipelineActiveNode(null);
      yield {
        type: "step",
        name,
        status: "done",
        ...(durationMs !== undefined ? { durationMs } : {}),
      } as const;
      yield* flushPipelineLogs();
      activeStep = null;
    }
  };
  /** 开始下一 step：记耗时起点、更新 activeNode、yield step running */
  const startStep = function* (name: PipelineStepName) {
    if (activeStep !== name) {
      timing.markNodeStart(name);
      setPipelineActiveNode(name);
      yield { type: "step", name, status: "running" } as const;
      activeStep = name;
    }
  };
  for await (const chunk of stream) {
    const [mode, payload] = chunk as ["updates" | "values" | "custom", unknown];
    if (mode === "values") {
      finalState = payload as PipelineGraphState;
      continue;
    }
    if (mode === "custom") {
      if (isAnalystStreamChunk(payload)) {
        timing.markFirstToken();
        yield payload;
      }
      continue;
    }
    const update = payload as Record<string, Partial<PipelineGraphState>>;
    const nodeName = Object.keys(update)[0];
    if (!nodeName) continue;
    const nodePatch = update[nodeName];
    if (nodePatch) {
      finalState = { ...finalState, ...nodePatch };
    }
    if (nodeName === "prepareTurnStart") {
      yield* finishStep("prepare_turn_start");
      yield* flushPipelineLogs();
      if (finalState.error && finalState.exitEarly) {
        yield { type: "error", message: finalState.error };
        const answer =
          finalState.answer ?? "（准备对话上下文失败，请稍后重试）";
        timing.markFirstToken();
        const pipelineTiming = yield* finishPipeline(timing);
        logAgentOut(
          "Pipeline",
          "出去",
          summarizePipelineOut(finalState, answer, pipelineTiming)
        );
        yield* emitAssistant(answer);
        return {
          answer,
          repeatQuestionHit: false,
          retrievalCacheHit: false,
          timing: pipelineTiming,
        };
      }
      if (!finalState.exitEarly && !finalState.repeatQuestionHit) {
        yield* startStep("intake");
      }
      continue;
    }
    if (nodeName === "intake") {
      yield* finishStep("intake");
      yield* flushPipelineLogs();
      if (finalState.error) {
        yield { type: "error", message: finalState.error };
        const answer =
          finalState.answer ??
          "（模型调用失败：请确认本地 Ollama 已启动且模型已拉取）";
        timing.markFirstToken();
        const pipelineTiming = yield* finishPipeline(timing);
        logAgentOut(
          "Pipeline",
          "出去",
          summarizePipelineOut(finalState, answer, pipelineTiming)
        );
        yield* emitAssistant(answer);
        return {
          answer,
          repeatQuestionHit: finalState.repeatQuestionHit,
          retrievalCacheHit: finalState.retrievalCacheHit,
          timing: pipelineTiming,
        };
      }
      if (finalState.decision?.userFact) {
        yield* startStep("user_fact");
      } else if (finalState.decision?.needsRetrieval) {
        yield* startStep("retrieval");
      } else if (finalState.decision?.intent === "summarize_content") {
        yield* startStep("content_summarizer");
      }
      continue;
    }
    if (nodeName === "userFact") {
      yield* finishStep("user_fact");
      if (finalState.answer) {
        timing.markFirstToken();
        yield* emitAssistant(finalState.answer);
      }
      if (finalState.error) {
        yield { type: "error", message: finalState.error };
      }
      yield* startStep("persist_turn_end");
      continue;
    }
    if (nodeName === "retrieval") {
      yield* finishStep("retrieval");
      yield {
        type: "retrieval_meta",
        cacheHit: Boolean(finalState.retrievalCacheHit),
      };
      if (finalState.decision?.intent === "summarize_content") {
        yield* startStep("content_summarizer");
      } else {
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
      } else {
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
      yield* startStep("persist_turn_end");
      continue;
    }
    if (nodeName === "respondEarly") {
      if (activeStep) {
        const durationMs = timing.markNodeEnd(activeStep);
        yield {
          type: "step",
          name: activeStep,
          status: "done",
          ...(durationMs !== undefined ? { durationMs } : {}),
        };
        activeStep = null;
      }
      yield* startStep("persist_turn_end");
      continue;
    }
    if (nodeName === "persistTurnEnd") {
      yield* finishStep("persist_turn_end");
      yield* flushPipelineLogs();
      continue;
    }
  }
  if (activeStep) {
    const durationMs = timing.markNodeEnd(activeStep);
    yield {
      type: "step",
      name: activeStep,
      status: "done",
      ...(durationMs !== undefined ? { durationMs } : {}),
    };
  }
  if (finalState.exitEarly && finalState.answer) {
    timing.markFirstToken();
    yield* emitAssistant(finalState.answer);
  }
  const answer =
    finalState.answer ?? "（未能生成回复，请稍后重试）";
  if (!finalState.exitEarly && !finalState.answer) {
    timing.markFirstToken();
    yield* emitAssistant(answer);
  }
  const pipelineTiming = yield* finishPipeline(timing);
  logAgentOut(
    "Pipeline",
    "出去",
    summarizePipelineOut(finalState, answer, pipelineTiming)
  );
  return {
    answer,
    repeatQuestionHit: finalState.repeatQuestionHit,
    retrievalCacheHit: finalState.retrievalCacheHit,
    compositeFacetCacheHits: finalState.compositeFacetCacheHits,
    timing: pipelineTiming,
    retrievalPaths: retrievalPathsFromState(finalState),
  };
}
