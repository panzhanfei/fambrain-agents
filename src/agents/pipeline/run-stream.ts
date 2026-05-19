import { completeIntakeCoordinator } from "@/agents/IntakeCoordinator";
import type { IntakeRoutingDecision } from "@/agents/IntakeCoordinator/prompt";
import { streamAnalyzeInformation } from "@/agents/InformationAnalyst/stream";
import type { InformationAnalystInput } from "@/agents/InformationAnalyst/prompt";
import { retrieveKnowledge } from "@/agents/KnowledgeManager";
import type { AgentPipelineResult, AgentStreamEvent, DbChatTurn } from "@/agents/types";

import {
  defaultIntakeDecision,
  parseIntakeDecision,
} from "./parse-intake";

function lastUserQuestion(history: DbChatTurn[]): string {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === "user") return history[i].content.trim();
  }
  return "";
}

function* emitAssistant(answer: string): Generator<AgentStreamEvent> {
  yield { type: "assistant", text: answer };
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
 * P0 流式编排：发 step → Intake →（可选）KM → Analyst 流式 thinking/assistant。
 */
export async function* runPipelineStream(
  history: DbChatTurn[]
): AsyncGenerator<AgentStreamEvent, AgentPipelineResult> {
  const userQuestion = lastUserQuestion(history);

  yield { type: "step", name: "intake", status: "running" };

  let intakeRaw: string;
  try {
    intakeRaw = await completeIntakeCoordinator(history);
  } catch (e) {
    const msg =
      e instanceof Error ? e.message : "入口接线员调用失败，请确认 Ollama 可用";
    yield { type: "error", message: msg };
    const answer =
      "（模型调用失败：请确认本地 Ollama 已启动且模型已拉取）";
    yield* emitAssistant(answer);
    return { answer };
  }

  yield { type: "step", name: "intake", status: "done" };

  const decision: IntakeRoutingDecision =
    parseIntakeDecision(intakeRaw) ?? defaultIntakeDecision(userQuestion);

  if (decision.intent === "clarify" && decision.clarifyingQuestion) {
    const answer = decision.clarifyingQuestion;
    yield* emitAssistant(answer);
    return { answer };
  }

  if (
    (decision.intent === "chitchat" || decision.intent === "out_of_scope") &&
    decision.briefReply
  ) {
    yield* emitAssistant(decision.briefReply);
    return { answer: decision.briefReply };
  }

  let hits: InformationAnalystInput["hits"] = [];
  let coverage: InformationAnalystInput["coverage"] = "none";
  let notes: InformationAnalystInput["notes"] = null;

  if (decision.needsRetrieval) {
    yield { type: "step", name: "retrieval", status: "running" };
    try {
      const retrieval = await retrieveKnowledge({
        searchQuery: decision.searchQuery || userQuestion,
        topics: decision.topics,
        subTasks: decision.subTasks,
        candidates: [],
      });
      hits = retrieval.hits;
      coverage = retrieval.coverage;
      notes = retrieval.notes;
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : "知识库检索失败";
      yield { type: "error", message: msg };
    }
    yield { type: "step", name: "retrieval", status: "done" };
  }

  if (!decision.needsRetrieval && decision.briefReply) {
    yield* emitAssistant(decision.briefReply);
    return { answer: decision.briefReply };
  }

  yield { type: "step", name: "analyst", status: "running" };

  const analystInput: InformationAnalystInput = {
    userQuestion,
    language: decision.language,
    subTasks: decision.subTasks,
    hits,
    coverage,
    notes,
  };

  try {
    const answer = yield* runAnalystStream(analystInput);
    yield { type: "step", name: "analyst", status: "done" };
    return { answer };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "信息分析师调用失败";
    yield { type: "error", message: msg };
    const answer = "（生成回答时出错，请稍后重试）";
    yield* emitAssistant(answer);
    return { answer };
  }
}
