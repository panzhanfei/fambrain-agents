import { END, START, StateGraph } from "@langchain/langgraph";
import { runContentOrganizerNode } from "@/agentflow/agents/online/content-organizer/content-organizer-node";
import { runContentSummarizerNode } from "@/agentflow/agents/online/content-summarizer/content-summarizer-node";
import { runIntakeNode } from "@/agentflow/agents/online/intake-coordinator/nodes/intake-node";
import { runRespondEarlyNode } from "@/agentflow/agents/online/respond-early";
import { userFactNode } from "@/agentflow/agents/online/user-fact";
import { runAnalystNode } from "@/agentflow/agents/online/information-analyst/analyst-node";
import { runPlanExecutorNode } from "@/agentflow/agents/online/tool-orchestrator";
import {
  runPreparePipelineMemory,
  runPrepareTurnStart,
} from "@/agentflow/agents/online/prepare-turn-start";
import {
  runRepeatQuestionGuard,
  runRepeatRespondEarlyNode,
} from "@/agentflow/agents/online/repeat-question-guard";
import { runPersistTurnEnd } from "@/agentflow/agents/online/persist-turn-end";
import { PipelineGraphAnnotation } from "./state";
import {
  routeAfterIntake,
  routeAfterPlanExecutor,
  routeAfterPrepareMemory,
  routeAfterRepeat,
} from "./routes";

const buildPipelineGraph = () => {
  return new StateGraph(PipelineGraphAnnotation)
    .addNode("prepareTurnStart", runPrepareTurnStart)
    .addNode("repeatQuestionGuard", runRepeatQuestionGuard)
    .addNode("repeatRespondEarly", runRepeatRespondEarlyNode)
    .addNode("preparePipelineMemory", runPreparePipelineMemory)
    .addNode("intake", runIntakeNode)
    .addNode("planExecutor", runPlanExecutorNode)
    .addNode("contentSummarizer", runContentSummarizerNode)
    .addNode("contentOrganizer", runContentOrganizerNode)
    .addNode("analyst", runAnalystNode)
    .addNode("userFact", userFactNode)
    .addNode("respondEarly", runRespondEarlyNode)
    .addNode("persistTurnEnd", runPersistTurnEnd)
    .addEdge(START, "prepareTurnStart")
    .addEdge("prepareTurnStart", "repeatQuestionGuard")
    .addConditionalEdges("repeatQuestionGuard", routeAfterRepeat)
    .addConditionalEdges("preparePipelineMemory", routeAfterPrepareMemory)
    .addConditionalEdges("intake", routeAfterIntake)
    .addEdge("userFact", "persistTurnEnd")
    .addEdge("repeatRespondEarly", "persistTurnEnd")
    .addConditionalEdges("planExecutor", routeAfterPlanExecutor)
    .addEdge("contentSummarizer", "respondEarly")
    .addEdge("contentOrganizer", "analyst")
    .addEdge("analyst", "persistTurnEnd")
    .addEdge("respondEarly", "persistTurnEnd")
    .addEdge("persistTurnEnd", END);
};

let compiledGraph: ReturnType<
  ReturnType<typeof buildPipelineGraph>["compile"]
> | null = null;

export const getCompiledPipelineGraph = () => {
  if (!compiledGraph) {
    compiledGraph = buildPipelineGraph().compile({ name: "fambrain-pipeline" });
  }
  return compiledGraph;
};
