import { END, START, StateGraph } from "@langchain/langgraph";
import { runContentOrganizerNode } from "@/agentflow/brain-service/online/content-organizer/content-organizer-node";
import { runContentSummarizerNode } from "@/agentflow/brain-service/online/content-summarizer/content-summarizer-node";
import { runFactCheckerNode } from "@/agentflow/brain-service/online/fact-checker/fact-checker-node";
import { runIntakeNode } from "@/agentflow/brain-service/online/intake-coordinator/intake-node";
import { runRespondEarlyNode } from "@/agentflow/brain-service/online/intake-coordinator/respond-early-node";
import { userFactNode } from "@/agentflow/brain-service/online/intake-coordinator/user-fact-node";
import { runAnalystNode } from "@/agentflow/brain-service/online/information-analyst/analyst-node";
import { runRetrievalNode } from "@/agentflow/brain-service/online/knowledge-manager/pipeline-retrieval";
import { runPrepareTurnStart } from "@/agentflow/brain-service/online/prepare-turn-start";
import { runPersistTurnEnd } from "@/agentflow/brain-service/online/persist-turn-end";
import { PipelineGraphAnnotation } from "./state";
import {
    routeAfterFactChecker,
    routeAfterIntake,
    routeAfterPrepare,
    routeAfterRetrieval,
} from "./routes";

const buildPipelineGraph = () => {
    return new StateGraph(PipelineGraphAnnotation)
        .addNode("persistTurnEnd", runPersistTurnEnd)
        .addNode("prepareTurnStart", runPrepareTurnStart)
        .addNode("intake", runIntakeNode)
        .addNode("retrieval", runRetrievalNode)
        .addNode("factChecker", runFactCheckerNode)
        .addNode("contentSummarizer", runContentSummarizerNode)
        .addNode("contentOrganizer", runContentOrganizerNode)
        .addNode("analyst", runAnalystNode)
        .addNode("userFact", userFactNode)
        .addNode("respondEarly", runRespondEarlyNode)
        .addEdge(START, "prepareTurnStart")
        .addConditionalEdges("prepareTurnStart", routeAfterPrepare)
        .addConditionalEdges("intake", routeAfterIntake)
        .addEdge("userFact", "persistTurnEnd")
        .addConditionalEdges("retrieval", routeAfterRetrieval)
        .addConditionalEdges("factChecker", routeAfterFactChecker)
        .addEdge("contentSummarizer", "respondEarly")
        .addEdge("contentOrganizer", "analyst")
        .addEdge("analyst", "persistTurnEnd")
        .addEdge("respondEarly", "persistTurnEnd")
        .addEdge("persistTurnEnd", END);
};

let compiledGraph: ReturnType<ReturnType<typeof buildPipelineGraph>["compile"]> | null = null;

export const getCompiledPipelineGraph = () => {
    if (!compiledGraph) {
        compiledGraph = buildPipelineGraph().compile({ name: "fambrain-pipeline" });
    }
    return compiledGraph;
};
