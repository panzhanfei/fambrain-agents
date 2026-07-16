import { END, START, StateGraph } from "@langchain/langgraph";
import { runContentOrganizerNode } from "@/agentflow/agents/online/content-organizer/content-organizer-node";
import { runContentSummarizerNode } from "@/agentflow/agents/online/content-summarizer/content-summarizer-node";
import { runFactCheckerNode } from "@/agentflow/agents/online/fact-checker/fact-checker-node";
import { runIntakeNode } from "@/agentflow/agents/online/intake-coordinator/nodes/intake-node";
import { runRespondEarlyNode } from "@/agentflow/agents/online/respond-early";
import { userFactNode } from "@/agentflow/agents/online/user-fact";
import { runAnalystNode } from "@/agentflow/agents/online/information-analyst/analyst-node";
import { runRetrievalNode } from "@/agentflow/agents/online/knowledge-manager";
import {
  runDagExecutorNode,
  runToolOrchestratorNode,
} from "@/agentflow/agents/online/tool-orchestrator";
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
  routeAfterFactChecker,
  routeAfterIntake,
  routeAfterPrepareMemory,
  routeAfterRepeat,
  routeAfterRetrieval,
} from "./routes";

const buildPipelineGraph = () => {
  return new StateGraph(PipelineGraphAnnotation)
    .addNode("prepareTurnStart", runPrepareTurnStart)
    .addNode("repeatQuestionGuard", runRepeatQuestionGuard)
    .addNode("repeatRespondEarly", runRepeatRespondEarlyNode)
    .addNode("preparePipelineMemory", runPreparePipelineMemory)
    .addNode("intake", runIntakeNode)
    .addNode("retrieval", runRetrievalNode)
    .addNode("dagExecutor", runDagExecutorNode)
    .addNode("toolOrchestrator", runToolOrchestratorNode)
    .addNode("factChecker", runFactCheckerNode)
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
    .addConditionalEdges("retrieval", routeAfterRetrieval)
    .addEdge("dagExecutor", "factChecker")
    .addConditionalEdges("factChecker", routeAfterFactChecker)
    .addEdge("contentSummarizer", "respondEarly")
    .addEdge("contentOrganizer", "toolOrchestrator")
    .addEdge("toolOrchestrator", "analyst")
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
