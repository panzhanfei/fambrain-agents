import { END, START, StateGraph, getWriter } from "@langchain/langgraph";
import type { LangGraphRunnableConfig } from "@langchain/langgraph";

import { logAgentOut } from "@fambrain/agent-shared/agent-log";

import { completeFactCheck } from "@/agentflow/agents/online/fact-checker";
import { completeIntakeCoordinator } from "@/agentflow/agents/online/intake-coordinator";
import { streamAnalyzeInformation } from "@/agentflow/agents/online/information-analyst";
import { retrieveKnowledge } from "@/agentflow/agents/online/knowledge-manager";
import {
  defaultIntakeDecision,
  parseIntakeDecision,
} from "../parse-intake";

import {
  PipelineGraphAnnotation,
  type PipelineGraphState,
} from "./state";

function routeAfterIntake(
  state: PipelineGraphState
): "respondEarly" | "retrieval" | "factChecker" {
  if (state.exitEarly || state.error) return "respondEarly";

  const decision = state.decision;
  if (!decision) return "respondEarly";

  if (decision.intent === "clarify" && decision.clarifyingQuestion) {
    return "respondEarly";
  }

  if (
    (decision.intent === "chitchat" || decision.intent === "out_of_scope") &&
    decision.briefReply
  ) {
    return "respondEarly";
  }

  if (decision.needsRetrieval) return "retrieval";

  if (!decision.needsRetrieval && decision.briefReply) {
    return "respondEarly";
  }

  return "factChecker";
}

function routeAfterFactChecker(
  state: PipelineGraphState
): "retrieval" | "analyst" {
  if (!state.checkerPassed && state.retryCount < 1) {
    return "retrieval";
  }
  return "analyst";
}

async function intakeNode(
  state: PipelineGraphState
): Promise<Partial<PipelineGraphState>> {
  try {
    const intakeRaw = await completeIntakeCoordinator(state.history);
    const decision =
      parseIntakeDecision(intakeRaw) ??
      defaultIntakeDecision(state.userQuestion);

    logAgentOut("Pipeline", "解析后的路由决策", decision);
    return { decision };
  } catch (e) {
    const msg =
      e instanceof Error ? e.message : "入口接线员调用失败，请确认 Ollama 可用";
    return {
      error: msg,
      answer: "（模型调用失败：请确认本地 Ollama 已启动且模型已拉取）",
      exitEarly: true,
    };
  }
}

async function retrievalNode(
  state: PipelineGraphState
): Promise<Partial<PipelineGraphState>> {
  const decision = state.decision;
  if (!decision) {
    return { error: "缺少入口路由决策" };
  }

  const fromRetry = !state.checkerPassed && state.retryCount < 1;

  try {
    const retrieval = await retrieveKnowledge({
      corpusUserId: state.context.corpusUserId,
      searchQuery: decision.searchQuery || state.userQuestion,
      topics: decision.topics,
      subTasks: decision.subTasks,
      candidates: [],
    });

    return {
      hits: retrieval.hits,
      coverage: retrieval.coverage,
      notes: retrieval.notes,
      retryCount: fromRetry ? state.retryCount + 1 : state.retryCount,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "知识库检索失败";
    return {
      error: msg,
      retryCount: fromRetry ? state.retryCount + 1 : state.retryCount,
    };
  }
}

function mergeAnalystNotes(
  kmNotes: string | null,
  checkerNotes: string | null
): string | null {
  const parts = [kmNotes, checkerNotes].filter(
    (n): n is string => typeof n === "string" && n.trim().length > 0
  );
  return parts.length > 0 ? parts.join(" ") : null;
}

async function factCheckerNode(
  state: PipelineGraphState
): Promise<Partial<PipelineGraphState>> {
  const decision = state.decision;
  if (!decision) {
    return { checkerPassed: true };
  }

  try {
    const result = await completeFactCheck({
      userQuestion: state.userQuestion,
      intent: decision.intent,
      needsRetrieval: decision.needsRetrieval,
      searchQuery: decision.searchQuery || state.userQuestion,
      subTasks: decision.subTasks,
      topics: decision.topics,
      language: decision.language,
      hits: state.hits,
      coverage: state.coverage,
      notes: state.notes,
      retryCount: state.retryCount,
    });

    const patch: Partial<PipelineGraphState> = {
      checkerPassed: result.passed,
      notes: mergeAnalystNotes(state.notes, result.checkerNotes),
    };

    if (
      !result.passed &&
      result.refinedSearchQuery &&
      state.retryCount < 1
    ) {
      patch.decision = {
        ...decision,
        searchQuery: result.refinedSearchQuery,
      };
    }

    logAgentOut("Pipeline", "事实核查", {
      passed: result.passed,
      evidenceScore: result.evidenceScore,
      retryCount: state.retryCount,
      issueCount: result.issues.length,
    });

    return patch;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "事实核查员调用失败";
    logAgentOut("Pipeline", "事实核查（异常，放行）", { error: msg });
    return { checkerPassed: true, error: msg };
  }
}

async function analystNode(
  state: PipelineGraphState,
  config: LangGraphRunnableConfig
): Promise<Partial<PipelineGraphState>> {
  const decision = state.decision;
  if (!decision) {
    return { answer: "（未能理解您的问题，请换一种方式描述）" };
  }

  const write = getWriter(config);

  try {
    const gen = streamAnalyzeInformation({
      userQuestion: state.userQuestion,
      language: decision.language,
      subTasks: decision.subTasks,
      hits: state.hits,
      coverage: state.coverage,
      notes: state.notes,
    });

    let result = await gen.next();
    while (!result.done) {
      write?.(result.value);
      result = await gen.next();
    }

    logAgentOut("Pipeline", "本轮结束（分析师终稿）", {
      answer: result.value.answer,
    });
    return { answer: result.value.answer };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "信息分析师调用失败";
    const answer = "（生成回答时出错，请稍后重试）";
    write?.({ type: "assistant", text: answer });
    return { error: msg, answer };
  }
}

function respondEarlyNode(
  state: PipelineGraphState
): Partial<PipelineGraphState> {
  if (state.answer) {
    return { exitEarly: true };
  }

  const decision = state.decision;
  if (!decision) {
    return {
      answer: "（未能理解您的问题，请换一种方式描述）",
      exitEarly: true,
    };
  }

  if (decision.intent === "clarify" && decision.clarifyingQuestion) {
    logAgentOut("Pipeline", "本轮结束（澄清，未调下游）", {
      answer: decision.clarifyingQuestion,
    });
    return { answer: decision.clarifyingQuestion, exitEarly: true };
  }

  if (decision.briefReply) {
    logAgentOut("Pipeline", "本轮结束（短回复）", {
      answer: decision.briefReply,
    });
    return { answer: decision.briefReply, exitEarly: true };
  }

  return {
    answer: "（未能生成回复，请稍后重试）",
    exitEarly: true,
  };
}

function buildPipelineGraph() {
  return new StateGraph(PipelineGraphAnnotation)
    .addNode("intake", intakeNode)
    .addNode("retrieval", retrievalNode)
    .addNode("factChecker", factCheckerNode)
    .addNode("analyst", analystNode)
    .addNode("respondEarly", respondEarlyNode)
    .addEdge(START, "intake")
    .addConditionalEdges("intake", routeAfterIntake)
    .addEdge("retrieval", "factChecker")
    .addConditionalEdges("factChecker", routeAfterFactChecker)
    .addEdge("analyst", END)
    .addEdge("respondEarly", END);
}

let compiledGraph: ReturnType<ReturnType<typeof buildPipelineGraph>["compile"]> | null =
  null;

export function getCompiledPipelineGraph() {
  if (!compiledGraph) {
    compiledGraph = buildPipelineGraph().compile();
  }
  return compiledGraph;
}
