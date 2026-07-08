import type { IntakeRoutingDecision } from "../contract/prompt";

/** 是否应进入 KnowledgeManager（LangGraph retrieval 节点） */
export const intakeRequiresKmRetrieval = (
    decision: Pick<IntakeRoutingDecision, "intent" | "needsRetrieval">
): boolean => {
    if (decision.intent === "retrieve_and_answer") return true;
    if (decision.intent === "summarize_content") return decision.needsRetrieval;
    return false;
};

/**
 * 将 needsRetrieval 与 intent 对齐（服务端推导，不依赖 LLM 填 retrieve 场景）。
 * - retrieve_and_answer → 恒 true
 * - summarize_content → 保留 LLM 值（粘贴长文可不查库）
 * - 其余 intent → false
 */
export const normalizeIntakeDecision = (
    decision: IntakeRoutingDecision
): IntakeRoutingDecision => ({
    ...decision,
    needsRetrieval: intakeRequiresKmRetrieval(decision),
});
