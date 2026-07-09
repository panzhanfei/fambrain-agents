import { END, START, StateGraph } from "@langchain/langgraph";
import { runContentOrganizerNode } from "@/agentflow/brain-service/online/content-organizer/content-organizer-node";
import { runContentSummarizerNode } from "@/agentflow/brain-service/online/content-summarizer/content-summarizer-node";
import { runFactCheckerNode } from "@/agentflow/brain-service/online/fact-checker/fact-checker-node";
import { runIntakeNode } from "@/agentflow/brain-service/online/intake-coordinator/nodes/intake-node";
import { runRespondEarlyNode } from "@/agentflow/brain-service/online/respond-early";
import { userFactNode } from "@/agentflow/brain-service/online/user-fact";
import { runAnalystNode } from "@/agentflow/brain-service/online/information-analyst/analyst-node";
import { runRetrievalNode } from "@/agentflow/brain-service/online/knowledge-manager";
import {
  runPreparePipelineMemory,
  runPrepareTurnStart,
} from "@/agentflow/brain-service/online/prepare-turn-start";
import {
  runRepeatQuestionGuard,
  runRepeatRespondEarlyNode,
} from "@/agentflow/brain-service/online/repeat-question-guard";
import { runPersistTurnEnd } from "@/agentflow/brain-service/online/persist-turn-end";
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
    .addConditionalEdges("factChecker", routeAfterFactChecker)
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
