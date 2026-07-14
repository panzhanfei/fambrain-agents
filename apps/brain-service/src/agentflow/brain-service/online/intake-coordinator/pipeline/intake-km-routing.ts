import type { IntakeRoutingDecision } from "@/agentflow/brain-service/online/intake-coordinator/contract";

/** 是否应进入 KnowledgeManager（LangGraph retrieval 节点） */
export const intakeRequiresKmRetrieval = (
    decision: Pick<IntakeRoutingDecision, "intent" | "searchQuery">
): boolean => {
    if (decision.intent === "retrieve_and_answer") return true;
    if (decision.intent === "summarize_content") {
        return Boolean(decision.searchQuery.trim());
    }
    return false;
};
