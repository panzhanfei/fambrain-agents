import type { PipelineGraphState } from "./state";
import { isUserFactIntent } from "@/agentflow/brain-service/online/user-fact";

export const routeAfterRepeat = (
    state: PipelineGraphState
): "repeatRespondEarly" | "preparePipelineMemory" => {
    if (state.repeatQuestionHit) return "repeatRespondEarly";
    return "preparePipelineMemory";
};

export const routeAfterPrepareMemory = (
    state: PipelineGraphState
): "respondEarly" | "intake" => {
    if (state.exitEarly || state.error) return "respondEarly";
    return "intake";
};

export const routeAfterIntake = (
    state: PipelineGraphState
): "respondEarly" | "userFact" | "retrieval" | "factChecker" | "contentSummarizer" => {
    if (state.exitEarly || state.error)
        return "respondEarly";
    const decision = state.decision;
    if (!decision)
        return "respondEarly";
    if (decision && isUserFactIntent(decision.intent)) {
        return "userFact";
    }
    if (decision.intent === "clarify" && decision.clarifyingQuestion) {
        return "respondEarly";
    }
    if ((decision.intent === "chitchat" || decision.intent === "out_of_scope") &&
        decision.briefReply) {
        return "respondEarly";
    }
    if (decision.intent === "summarize_content") {
        if (decision.needsRetrieval)
            return "retrieval";
        return "contentSummarizer";
    }
    if (decision.needsRetrieval)
        return "retrieval";
    if (!decision.needsRetrieval && decision.briefReply) {
        return "respondEarly";
    }
    return "factChecker";
};

export const routeAfterRetrieval = (
    state: PipelineGraphState
): "factChecker" | "contentSummarizer" => {
    if (state.decision?.intent === "summarize_content") {
        return "contentSummarizer";
    }
    return "factChecker";
};

export const routeAfterFactChecker = (
    state: PipelineGraphState
): "retrieval" | "contentOrganizer" => {
    if (!state.checkerPassed && state.retryCount < 1) {
        return "retrieval";
    }
    return "contentOrganizer";
};
