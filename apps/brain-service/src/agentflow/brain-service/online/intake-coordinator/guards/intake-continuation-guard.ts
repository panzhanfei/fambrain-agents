/**
 * 多轮续问 guard：短句续问 / 误 clarify → retrieve；queryType 继承 decision 或 history 中的 URL 结构信号。
 */
import type { DbChatTurn } from "@fambrain/brain-types";
import type { IntakeRoutingDecision } from "@/agentflow/brain-service/online/intake-coordinator/contract";
import { EXTERNAL_LINK_SLOT } from "@/agentflow/brain-service/online/intake-coordinator/composite";
import {
    decisionRequestsExternalLink,
    historyContainsUrl,
    historySupportsContinuation,
    isShortContinuationUtterance,
    lastSubstantiveUserQuestion,
} from "../query-signals";

export type IntakeContinuationGuardReason =
    | "noop"
    | "elliptical_retrieve"
    | "clarify_to_retrieve";

export const applyIntakeContinuationGuard = (
    decision: IntakeRoutingDecision,
    userQuestion: string,
    history: DbChatTurn[]
): IntakeRoutingDecision & { continuationGuardReason?: IntakeContinuationGuardReason } => {
    if (!historySupportsContinuation(history)) {
        return { ...decision, continuationGuardReason: "noop" };
    }

    const elliptical = isShortContinuationUtterance(userQuestion);
    const clarifyMisroute =
        decision.intent === "clarify" &&
        Boolean(decision.clarifyingQuestion?.trim());

    if (!elliptical && !clarifyMisroute) {
        return { ...decision, continuationGuardReason: "noop" };
    }

    const linkTopic =
        decisionRequestsExternalLink(decision) || historyContainsUrl(history);

    const prior = lastSubstantiveUserQuestion(history);
    const searchQuery = linkTopic
        ? EXTERNAL_LINK_SLOT.searchQuery
        : (prior ?? userQuestion).trim().slice(0, 240);

    const queryType = linkTopic
        ? "external_link"
        : (decision.queryType ?? "default");

    return {
        ...decision,
        intent: "retrieve_and_answer",
        searchQuery,
        queryType,
        topics: linkTopic ? [...EXTERNAL_LINK_SLOT.topics] : decision.topics,
        subTasks: prior ? [prior.slice(0, 80)] : decision.subTasks,
        clarifyingQuestion: null,
        briefReply: null,
        retrievalPlan: [],
        confidence: Math.max(decision.confidence, 0.82),
        continuationGuardReason: elliptical
            ? "elliptical_retrieve"
            : "clarify_to_retrieve",
    };
};
