/**
 * Pipeline 在线编排 SSE 壳（LangGraph 消费 + 耗时统计）。
 *
 * 职责划分：
 * - graph/：LangGraph 状态、路由、节点注册（compile.ts）
 * - brain-service/online/*：各节点业务实现
 * - 本目录：SSE 事件、步骤耗时、Pipeline 出去日志
 *
 * 对外入口：runPipelineStream()，由 HTTP routes / eval / golden 调用。
 */
import { ensureBrainServiceRuntime } from "@/config";
import { isPureSummarizeDecision } from "@/agentflow/agents/online/content-summarizer/summarize-route";
import { isPureListDecision } from "@/agentflow/agents/online/corpus-lister/pure-list-route";
import { intakeRequiresKmRetrieval } from "@/agentflow/agents/online/intake-coordinator/pipeline/intake-km-routing";
import { isUserFactIntent } from "@/agentflow/agents/online/user-fact";
import { buildLangGraphRunConfig } from "@fambrain/brain-config/langsmith";
import { logAgentOut } from "@fambrain/brain-shared/agent-log";
import type {
  AgentPipelineContext,
  AgentPipelineResult,
  AgentStreamEvent,
  AssistantMessageBlock,
  DbChatTurn,
  PipelineLogEntry,
  PipelineStepName,
  PipelineTiming,
  TurnStepEvent,
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
  | { type: "thinking"; text: string }
  | { type: "assistant"; text: string }
  | { type: "ui_block"; block: AssistantMessageBlock };

/** 向 SSE 推送一条 assistant 终稿/流式文本事件 */
function* emitAssistant(answer: string): Generator<AgentStreamEvent> {
  yield { type: "assistant", text: answer };
}

const isAnalystStreamChunk = (value: unknown): value is AnalystStreamChunk => {
  if (!value || typeof value !== "object") return false;
  const chunk = value as {
    type?: unknown;
    text?: unknown;
    block?: unknown;
  };
  if (chunk.type === "ui_block") {
    return chunk.block != null && typeof chunk.block === "object";
  }
  return (
    (chunk.type === "thinking" || chunk.type === "assistant") &&
    typeof chunk.text === "string"
  );
};

const analystChunkToStreamEvent = (
  chunk: AnalystStreamChunk
): AgentStreamEvent => {
  if (chunk.type === "ui_block") {
    return { type: "ui_block", block: chunk.block };
  }
  return chunk;
};

/** 从 finalState.hits 提取去重后的 corpus path，供 AgentPipelineResult */
const retrievalPathsFromState = (state: PipelineGraphState): string[] => {
  const paths = state.hits
    .map((h) => h.path?.trim())
    .filter((p): p is string => Boolean(p));
  return [...new Set(paths)];
};

const upsertCollectedStep = (
  steps: TurnStepEvent[],
  event: TurnStepEvent
): void => {
  const idx = steps.findIndex((s) => s.name === event.name);
  if (idx >= 0) {
    steps[idx] = { ...steps[idx], ...event };
    return;
  }
  steps.push(event);
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
  requiresKmRetrieval:
    state.decision && intakeRequiresKmRetrieval(state.decision)
      ? true
      : state.decision
        ? false
        : null,
  hitCount: state.hits.length,
  coverage: state.coverage,
  checkerPassed: state.checkerPassed,
  retryCount: state.retryCount,
  confidenceTier: state.confidenceTier,
  repeatQuestionHit: state.repeatQuestionHit,
  retrievalCacheHit: state.retrievalCacheHit,
  retrievalCacheSlotHits: state.retrievalCacheSlotHits,
  routeMode: state.decision?.routeMode ?? null,
  composeMode: state.decision?.composeMode ?? null,
  pathPlanCounts: state.decision?.pathPlan
    ? {
        km: state.decision.pathPlan.km.length,
        list: state.decision.pathPlan.list.length,
        tool: state.decision.pathPlan.tool.length,
        dag: state.decision.pathPlan.dag.length,
      }
    : null,
  stepResultCount: state.stepResults?.length ?? 0,
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
  timing: PipelineTimingTracker,
  collectedLogs: PipelineLogEntry[]
): Generator<AgentStreamEvent, PipelineTiming> {
  yield* flushPipelineLogs(collectedLogs);
  const tokenTracker = pipelineRunStorage.getStore()?.tokenTracker;
  const snapshot: PipelineTiming = {
    ...timing.snapshot(),
    ...(tokenTracker ? { tokens: tokenTracker.snapshot() } : {}),
  };
  yield { type: "pipeline_timing", timing: snapshot };
  return snapshot;
};

/** 把 AsyncLocalStorage 队列里积压的 Agent 日志批量 yield 为 pipeline_log SSE 事件 */
function* flushPipelineLogs(
  collectedLogs: PipelineLogEntry[]
): Generator<AgentStreamEvent> {
  for (const entry of drainPipelineLogQueue()) {
    collectedLogs.push(entry);
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
 * 业务节点在 brain-service/online/*；图拓扑在 graph/compile.ts。
 */
async function* runPipelineStreamInner(
  history: DbChatTurn[],
  context: AgentPipelineContext
): AsyncGenerator<AgentStreamEvent, AgentPipelineResult> {
  ensureBrainServiceRuntime();
  const userQuestion = lastUserQuestion(history);
  const timing = new PipelineTimingTracker();
  const collectedLogs: PipelineLogEntry[] = [];
  const collectedSteps: TurnStepEvent[] = [];
  const graph = getCompiledPipelineGraph();
  const input = buildInitialState(history, context, userQuestion);
  let finalState: PipelineGraphState = input;
  let activeStep: PipelineStepName | null = "prepare_turn_start";
  timing.markNodeStart("prepare_turn_start");
  setPipelineActiveNode("prepare_turn_start");
  upsertCollectedStep(collectedSteps, {
    name: "prepare_turn_start",
    status: "running",
  });
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
      upsertCollectedStep(collectedSteps, {
        name,
        status: "done",
        ...(durationMs !== undefined ? { durationMs } : {}),
      });
      yield {
        type: "step",
        name,
        status: "done",
        ...(durationMs !== undefined ? { durationMs } : {}),
      } as const;
      yield* flushPipelineLogs(collectedLogs);
      activeStep = null;
    }
  };
  /** 开始下一 step：记耗时起点、更新 activeNode、yield step running */
  const startStep = function* (name: PipelineStepName) {
    if (activeStep !== name) {
      timing.markNodeStart(name);
      setPipelineActiveNode(name);
      upsertCollectedStep(collectedSteps, { name, status: "running" });
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
        yield analystChunkToStreamEvent(payload);
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
      yield* flushPipelineLogs(collectedLogs);
      yield* startStep("repeat_question_guard");
      continue;
    }
    if (nodeName === "repeatQuestionGuard") {
      yield* finishStep("repeat_question_guard");
      yield* flushPipelineLogs(collectedLogs);
      if (finalState.repeatQuestionHit) {
        yield* startStep("repeat_respond_early");
      } else {
        yield* startStep("prepare_pipeline_memory");
      }
      continue;
    }
    if (nodeName === "preparePipelineMemory") {
      yield* finishStep("prepare_pipeline_memory");
      yield* flushPipelineLogs(collectedLogs);
      if (finalState.error && finalState.exitEarly) {
        yield { type: "error", message: finalState.error };
        const answer =
          finalState.answer ?? "（准备对话上下文失败，请稍后重试）";
        timing.markFirstToken();
        const pipelineTiming = yield* finishPipeline(timing, collectedLogs);
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
          logs: [...collectedLogs],
          steps: [...collectedSteps],
        };
      }
      yield* startStep("intake");
      continue;
    }
    if (nodeName === "repeatRespondEarly") {
      yield* finishStep("repeat_respond_early");
      yield* flushPipelineLogs(collectedLogs);
      yield* startStep("persist_turn_end");
      continue;
    }
    if (nodeName === "intake") {
      yield* finishStep("intake");
      yield* flushPipelineLogs(collectedLogs);
      if (finalState.error) {
        yield { type: "error", message: finalState.error };
        const answer =
          finalState.answer ??
          "（模型调用失败：请确认本地 Ollama 已启动且模型已拉取）";
        timing.markFirstToken();
        const pipelineTiming = yield* finishPipeline(timing, collectedLogs);
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
          logs: [...collectedLogs],
          steps: [...collectedSteps],
        };
      }
      const decision = finalState.decision;
      if (decision && isUserFactIntent(decision.intent)) {
        // 与 routeAfterIntake → userFact 对齐；勿依赖 decision.userFact（Intake 早退未必挂载）
        yield* startStep("user_fact");
      } else if (decision && isPureSummarizeDecision(decision)) {
        yield* startStep("content_summarizer");
      } else if (decision && isPureListDecision(decision)) {
        // 纯列举短路：listRetriever 节点对外仍报 retrieval（兼容旧 SSE）
        yield* startStep("retrieval");
      } else if (
        decision &&
        (intakeRequiresKmRetrieval(decision) ||
          (decision.pathPlan &&
            decision.pathPlan.km.length +
              decision.pathPlan.list.length +
              decision.pathPlan.tool.length +
              decision.pathPlan.dag.length >
              0) ||
          decision.routeMode === "dag" ||
          decision.routeMode === "slots")
      ) {
        // PathPlan 主路径：planExecutor（不再有独立 retrieval / fact_checker 图节点）
        yield* startStep("plan_executor");
      }
      continue;
    }
    if (nodeName === "listRetriever") {
      yield* finishStep("retrieval");
      yield {
        type: "retrieval_meta",
        cacheHit: false,
      };
      yield* startStep("content_organizer");
      if (finalState.error) {
        yield { type: "error", message: finalState.error };
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
    if (nodeName === "planExecutor") {
      yield* finishStep("plan_executor");
      yield {
        type: "retrieval_meta",
        cacheHit: Boolean(finalState.retrievalCacheHit),
      };
      yield* startStep("content_organizer");
      if (finalState.error) {
        yield { type: "error", message: finalState.error };
      }
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
      if (finalState.exitEarly && finalState.answer) {
        timing.markFirstToken();
        yield* emitAssistant(finalState.answer);
      } else if (!finalState.exitEarly) {
        yield* startStep("analyst");
      }
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
      yield* startStep("content_summarizer");
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
        upsertCollectedStep(collectedSteps, {
          name: activeStep,
          status: "done",
          ...(durationMs !== undefined ? { durationMs } : {}),
        });
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
      yield* flushPipelineLogs(collectedLogs);
      continue;
    }
  }
  if (activeStep) {
    const durationMs = timing.markNodeEnd(activeStep);
    upsertCollectedStep(collectedSteps, {
      name: activeStep,
      status: "done",
      ...(durationMs !== undefined ? { durationMs } : {}),
    });
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
  const pipelineTiming = yield* finishPipeline(timing, collectedLogs);
  logAgentOut(
    "Pipeline",
    "出去",
    summarizePipelineOut(finalState, answer, pipelineTiming)
  );
  const blocks = finalState.assistantBlocks ?? undefined;
  if (blocks?.length) {
    yield {
      type: "assistant_message",
      message: { plainText: answer, blocks },
    };
  }
  return {
    answer,
    blocks,
    repeatQuestionHit: finalState.repeatQuestionHit,
    retrievalCacheHit: finalState.retrievalCacheHit,
    compositeFacetCacheHits: finalState.compositeFacetCacheHits,
    timing: pipelineTiming,
    retrievalPaths: retrievalPathsFromState(finalState),
    logs: [...collectedLogs],
    steps: [...collectedSteps],
  };
}
