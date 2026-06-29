/**
 * Pipeline 在线编排入口（图外 + LangGraph 图内）。
 *
 * 职责划分：
 * - 本文件（stream.ts）：Mem0 准备、L1 重复问、SSE 事件、耗时统计、轮次后持久化
 * - compile.ts：LangGraph 节点定义与路由（intake → KM → FC → …）
 *
 * 对外入口：runPipelineStream()，由 HTTP routes / eval / golden 调用。
 */
import { ensureAgentsRuntime } from "@/config";
import { buildLangGraphRunConfig } from "@fambrain/agent-config/langsmith";
import { logAgentIn, logAgentOut } from "@fambrain/agent-shared/agent-log";
import type {
  AgentPipelineContext,
  AgentPipelineResult,
  AgentStreamEvent,
  DbChatTurn,
  PipelineStepName,
  PipelineTiming,
} from "@fambrain/agent-types";
import {
  createPipelineRunStore,
  drainPipelineLogQueue,
  pipelineRunStorage,
  setPipelineActiveNode,
} from "@fambrain/agent-shared/pipeline-run-context";
import { getCompiledPipelineGraph } from "./compile";
import { PipelineTimingTracker } from "./pipeline-timing";
import type { PipelineGraphState } from "./state";
import { findRepeatAnswerInHistory } from "@/agentflow/agents/online/intake-coordinator";
import {
  persistPipelineMemory,
  preparePipelineMemory,
} from "@fambrain/agent-memory";
import { persistLearningAfterTurn } from "@/agentflow/agents/offline/learning";

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

/** 从 history 末尾向前取最后一条 user 消息，作为本轮 userQuestion */
const lastUserQuestion = (history: DbChatTurn[]): string => {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === "user") return history[i].content.trim();
  }
  return "";
};

/** 向 SSE 推送一条 assistant 终稿/流式文本事件 */
function* emitAssistant(answer: string): Generator<AgentStreamEvent> {
  yield { type: "assistant", text: answer };
}

/**
 * 构造 LangGraph 初始状态（空 decision / 空 hits）。
 * memoryBlock、intakeHistory、userMemories 来自 preparePipelineMemory（图外 Mem0/LangMem）。
 */
const buildInitialState = (
  history: DbChatTurn[],
  context: AgentPipelineContext,
  userQuestion: string,
  memoryBlock: string | null,
  intakeHistory: DbChatTurn[],
  userMemories: string[]
): PipelineGraphState => {
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
    userMemories,
    intakeHistory,
    confidenceTier: null,
    repeatQuestionHit: false,
    retrievalCacheHit: false,
    retrievalCacheSlotHits: null,
    compositeSubResults: null,
    compositeIncrementalPlan: null,
    compositeFacetCacheHits: null,
  };
};

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

/** 轮次后 Mem0/Learning 持久化失败时写 Pipeline 日志，不抛错中断主流程 */
const logPersistMemoryFailure = (e: unknown): void => {
  const message = e instanceof Error ? e.message : String(e);
  logAgentOut("Pipeline", "persist_memory_failed", { error: message });
};

/** 从 finalState.hits 提取去重后的 corpus path，供 Learning 反馈与 Phase D 元数据 */
const retrievalPathsFromState = (state: PipelineGraphState): string[] => {
  const paths = state.hits
    .map((h) => h.path?.trim())
    .filter((p): p is string => Boolean(p));
  return [...new Set(paths)];
};

/**
 * 图结束后的副作用（不在 LangGraph 节点内）：
 * - persistPipelineMemory：Mem0 抽记忆 + LangMem 摘要
 * - persistLearningAfterTurn：Learning 候选（userFact 轮次跳过）
 * L1 重复问短路时不写。
 */
const persistTurnSideEffects = async (input: {
  context: AgentPipelineContext;
  history: DbChatTurn[];
  userQuestion: string;
  answer: string;
  finalState: PipelineGraphState;
}): Promise<void> => {
  if (input.finalState.repeatQuestionHit) return;
  await persistPipelineMemory({
    context: input.context,
    history: input.history,
    userQuestion: input.userQuestion,
    answer: input.answer,
  }).catch(logPersistMemoryFailure);
  if (!input.finalState.decision?.userFact) {
    await persistLearningAfterTurn({
      context: input.context,
      userQuestion: input.userQuestion,
      answer: input.answer,
      retrievalPaths: retrievalPathsFromState(input.finalState),
    }).catch(logPersistMemoryFailure);
  }
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

/**
 * L1 同问短路：history 中已有相同 normalize 问法 → 直接复用 assistant 答。
 *
 * 开关：`REPEAT_QUESTION_CACHE_DISABLED=1` 时 findRepeatAnswerInHistory 恒为 null，不会进入本分支。
 * 跳过 Mem0 / LangGraph / Intake LLM / KM；UI 仍 emit intake step 以保持步骤条一致。
 */
async function* runL1RepeatQuestionShortCircuit(input: {
  history: DbChatTurn[];
  context: AgentPipelineContext;
  userQuestion: string;
  repeatAnswer: string;
  timing: PipelineTimingTracker;
}): AsyncGenerator<AgentStreamEvent, AgentPipelineResult> {
  input.timing.markNodeStart("intake");
  yield { type: "step", name: "intake", status: "running" };
  input.timing.markFirstToken();
  const intakeMs = input.timing.markNodeEnd("intake");
  yield {
    type: "step",
    name: "intake",
    status: "done",
    ...(intakeMs !== undefined ? { durationMs: intakeMs } : {}),
  };
  const pipelineTiming = yield* finishPipeline(input.timing);
  const repeatState: PipelineGraphState = {
    ...buildInitialState(
      input.history,
      input.context,
      input.userQuestion,
      null,
      input.history,
      []
    ),
    answer: input.repeatAnswer,
    exitEarly: true,
    repeatQuestionHit: true,
  };
  logAgentOut(
    "Pipeline",
    "出去",
    summarizePipelineOut(repeatState, input.repeatAnswer, pipelineTiming)
  );
  yield* flushPipelineLogs();
  yield* emitAssistant(input.repeatAnswer);
  return {
    answer: input.repeatAnswer,
    repeatQuestionHit: true,
    retrievalCacheHit: false,
    timing: pipelineTiming,
  };
}

/**
 * 在线 Pipeline 对外入口。
 * 为本轮创建 pipelineRunStorage（token 统计、日志队列、当前 node），再委托 runPipelineStreamInner。
 */
export async function* runPipelineStream(
  history: DbChatTurn[],
  context: AgentPipelineContext
): AsyncGenerator<AgentStreamEvent, AgentPipelineResult> {
  const runStore = createPipelineRunStore();
  pipelineRunStorage.enterWith(runStore);
  return yield* runPipelineStreamInner(history, context);
}

/**
 * Pipeline 主流程（图外 + LangGraph stream 消费循环）。
 *
 * 顺序：
 * 1. Pipeline 进入日志
 * 2. L1 重复问短路（可选，跳过 LLM/KM）
 * 3. preparePipelineMemory（Mem0 + LangMem，图外）
 * 4. graph.stream：按 node 更新 yield step / pipeline_log / thinking / assistant
 * 5. exitEarly 或 analyst 完成 → persistTurnSideEffects → Pipeline 出去
 */
async function* runPipelineStreamInner(
  history: DbChatTurn[],
  context: AgentPipelineContext
): AsyncGenerator<AgentStreamEvent, AgentPipelineResult> {
  ensureAgentsRuntime();
  const userQuestion = lastUserQuestion(history);
  const timing = new PipelineTimingTracker();
  logAgentIn("Pipeline", "进入", {
    userQuestion,
    historyTurns: history.length,
    actorUserId: context.actorUserId,
    corpusUserId: context.corpusUserId,
    displayName: context.displayName,
    conversationId: context.conversationId,
  });
  yield* flushPipelineLogs();

  const repeatAnswer = findRepeatAnswerInHistory(history, userQuestion);
  /**
   *  L1 重复问短路（跳过 LLM/KM）
   */
  if (repeatAnswer) {
    return yield* runL1RepeatQuestionShortCircuit({
      history,
      context,
      userQuestion,
      repeatAnswer,
      timing,
    });
  }

  /**
   *  常规 Pipeline 流程
   */

  const memory = await preparePipelineMemory({
    context,
    history,
    userQuestion,
  });
  yield* flushPipelineLogs();
  const graph = getCompiledPipelineGraph();
  const input = buildInitialState(
    history,
    context,
    userQuestion,
    memory.promptBlock,
    memory.intakeHistory,
    memory.userMemories
  );
  let finalState: PipelineGraphState = input;
  let activeStep: PipelineStepName | null = "intake";
  timing.markNodeStart("intake");
  setPipelineActiveNode("intake");
  yield { type: "step", name: "intake", status: "running" };
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
    const pipelineTiming = yield* finishPipeline(timing);
    logAgentOut(
      "Pipeline",
      "出去",
      summarizePipelineOut(finalState, finalState.answer, pipelineTiming)
    );
    yield* emitAssistant(finalState.answer);
    if (!finalState.repeatQuestionHit) {
      await persistTurnSideEffects({
        context,
        history,
        userQuestion,
        answer: finalState.answer,
        finalState,
      });
    }
    return {
      answer: finalState.answer,
      repeatQuestionHit: finalState.repeatQuestionHit,
      retrievalCacheHit: finalState.retrievalCacheHit,
      compositeFacetCacheHits: finalState.compositeFacetCacheHits,
      timing: pipelineTiming,
      retrievalPaths: retrievalPathsFromState(finalState),
    };
  }
  const answer = finalState.answer ?? "（未能生成回复，请稍后重试）";
  if (!finalState.answer) {
    timing.markFirstToken();
    yield* emitAssistant(answer);
  }
  await persistTurnSideEffects({
    context,
    history,
    userQuestion,
    answer,
    finalState,
  });
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
