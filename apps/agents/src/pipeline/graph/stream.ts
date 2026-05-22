import { streamAnalyzeInformation } from "../../information-analyst/stream";
import type { InformationAnalystInput } from "../../information-analyst/prompt";
import { logAgentIn, logAgentOut } from "@fambrain/agent-shared/agent-log";
import type {
  AgentPipelineContext,
  AgentPipelineResult,
  AgentStreamEvent,
  DbChatTurn,
} from "@fambrain/agent-types";

import { getCompiledPipelineGraph } from "./compile";
import type { PipelineGraphState } from "./state";

type PipelineStepName = "intake" | "retrieval" | "analyst";

const GRAPH_STEP_NODES = {
  intake: "intake",
  retrieval: "retrieval",
} as const satisfies Record<string, PipelineStepName>;

type GraphStepNode = keyof typeof GRAPH_STEP_NODES;

function lastUserQuestion(history: DbChatTurn[]): string {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === "user") return history[i].content.trim();
  }
  return "";
}

function* emitAssistant(answer: string): Generator<AgentStreamEvent> {
  yield { type: "assistant", text: answer };
}

function buildInitialState(
  history: DbChatTurn[],
  context: AgentPipelineContext,
  userQuestion: string
): PipelineGraphState {
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
  };
}

function isGraphStepNode(nodeName: string): nodeName is GraphStepNode {
  return nodeName in GRAPH_STEP_NODES;
}

async function* runAnalystStream(
  input: InformationAnalystInput
): AsyncGenerator<AgentStreamEvent, string> {
  const gen = streamAnalyzeInformation(input);
  let result = await gen.next();

  while (!result.done) {
    const chunk = result.value;
    if (chunk.type === "thinking") {
      yield { type: "thinking", text: chunk.text };
    } else {
      yield { type: "assistant", text: chunk.text };
    }
    result = await gen.next();
  }

  return result.value.answer;
}

/**
 * LangGraph 流式编排：graph 负责 Intake / KM / FactChecker 路由；
 * Analyst 仍用 async generator 流式转发 thinking / assistant。
 */
export async function* runPipelineStream(
  history: DbChatTurn[],
  context: AgentPipelineContext
): AsyncGenerator<AgentStreamEvent, AgentPipelineResult> {
  const userQuestion = lastUserQuestion(history);

  logAgentIn("Pipeline", "本轮开始", {
    userQuestion,
    historyTurns: history.length,
    actorUserId: context.actorUserId,
    corpusUserId: context.corpusUserId,
    displayName: context.displayName,
  });

  const graph = getCompiledPipelineGraph();
  const input = buildInitialState(history, context, userQuestion);

  let finalState: PipelineGraphState = input;
  let activeStep: GraphStepNode | null = null;

  yield { type: "step", name: "intake", status: "running" };
  activeStep = "intake";

  const stream = await graph.stream(input as Parameters<typeof graph.stream>[0], {
    streamMode: ["updates", "values"],
  });

  for await (const chunk of stream) {
    const [mode, payload] = chunk as ["updates" | "values", unknown];

    if (mode === "values") {
      finalState = payload as PipelineGraphState;
      continue;
    }

    const update = payload as Record<string, Partial<PipelineGraphState>>;
    const nodeName = Object.keys(update)[0];
    if (!nodeName) continue;

    const nodePatch = update[nodeName];
    if (nodePatch) {
      finalState = { ...finalState, ...nodePatch };
    }

    if (!isGraphStepNode(nodeName)) continue;

    if (activeStep === nodeName) {
      yield {
        type: "step",
        name: GRAPH_STEP_NODES[nodeName],
        status: "done",
      };
      activeStep = null;
    }

    if (nodeName === "intake" && finalState.error) {
      yield { type: "error", message: finalState.error };
      const answer =
        finalState.answer ??
        "（模型调用失败：请确认本地 Ollama 已启动且模型已拉取）";
      yield* emitAssistant(answer);
      return { answer };
    }

    if (nodeName === "intake" && finalState.decision?.needsRetrieval) {
      yield { type: "step", name: "retrieval", status: "running" };
      activeStep = "retrieval";
    }

    if (nodeName === "retrieval" && finalState.error) {
      yield { type: "error", message: finalState.error };
    }
  }

  if (activeStep) {
    yield {
      type: "step",
      name: GRAPH_STEP_NODES[activeStep],
      status: "done",
    };
  }

  if (finalState.exitEarly && finalState.answer) {
    logAgentOut("Pipeline", "本轮结束（图提前退出）", {
      answer: finalState.answer,
    });
    yield* emitAssistant(finalState.answer);
    return { answer: finalState.answer };
  }

  const decision = finalState.decision;
  if (!decision) {
    const answer = "（未能理解您的问题，请换一种方式描述）";
    yield* emitAssistant(answer);
    return { answer };
  }

  yield { type: "step", name: "analyst", status: "running" };

  const analystInput: InformationAnalystInput = {
    userQuestion,
    language: decision.language,
    subTasks: decision.subTasks,
    hits: finalState.hits,
    coverage: finalState.coverage,
    notes: finalState.notes,
  };

  try {
    const answer = yield* runAnalystStream(analystInput);
    yield { type: "step", name: "analyst", status: "done" };
    logAgentOut("Pipeline", "本轮结束（分析师终稿）", { answer });
    return { answer };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "信息分析师调用失败";
    yield { type: "error", message: msg };
    const answer = "（生成回答时出错，请稍后重试）";
    yield* emitAssistant(answer);
    return { answer };
  }
}
