/**
 * 多轮续问 guard：短句续问 / 误 clarify → retrieve；queryType 继承 decision 或 history 中的 URL 结构信号。
 * 若 LLM 已给出实质 searchQuery（≠ 短句原文），不覆盖。
 */
import type { DbChatTurn } from "@fambrain/brain-types";
import type { IntakeRoutingDecision } from "@/agentflow/agents/online/intake-coordinator/contract";
import { EXTERNAL_LINK_SLOT } from "@/agentflow/agents/online/intake-coordinator/composite";
import { isUserFactIntent } from "@/agentflow/agents/online/user-fact";
import {
    decisionRequestsExternalLink,
    historyContainsUrl,
    historySupportsContinuation,
    isShortContinuationUtterance,
    lastSubstantiveUserQuestion,
} from "../signals";

export type IntakeContinuationGuardReason =
    | "noop"
    | "elliptical_retrieve"
    | "clarify_to_retrieve";

export const applyIntakeContinuationGuard = (
    decision: IntakeRoutingDecision,
    userQuestion: string,
    history: DbChatTurn[]
): IntakeRoutingDecision & { continuationGuardReason?: IntakeContinuationGuardReason } => {
    // remember / recall 是独立分支，禁止续问 guard 改写成 retrieve
    if (isUserFactIntent(decision.intent)) {
        return { ...decision, continuationGuardReason: "noop" };
    }

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

    const llmQuery = decision.searchQuery.trim();
    const llmAlreadyResolved =
        decision.intent === "retrieve_and_answer" &&
        llmQuery.length >= 8 &&
        llmQuery !== userQuestion.trim() &&
        !clarifyMisroute;

    // LLM 已补全实体检索词：非链接续问勿覆盖
    if (llmAlreadyResolved && !linkTopic) {
        return { ...decision, continuationGuardReason: "noop" };
    }

    const prior = lastSubstantiveUserQuestion(history, userQuestion);
    const searchQuery = linkTopic
        ? EXTERNAL_LINK_SLOT.searchQuery
        : (llmAlreadyResolved
              ? llmQuery
              : (prior ?? userQuestion).trim()
          ).slice(0, 240);

    const queryType = linkTopic
        ? "external_link"
        : (decision.queryType ?? "default");

    return {
        ...decision,
        intent: "retrieve_and_answer",
        searchQuery,
        queryType,
        topics: linkTopic ? [...EXTERNAL_LINK_SLOT.topics] : decision.topics,
        subTasks:
            decision.subTasks.length > 0
                ? decision.subTasks
                : prior
                  ? [prior.slice(0, 80)]
                  : decision.subTasks,
        clarifyingQuestion: null,
        briefReply: null,
        retrievalPlan: decision.retrievalPlan ?? [],
        confidence: Math.max(decision.confidence, 0.82),
        continuationGuardReason: elliptical
            ? "elliptical_retrieve"
            : "clarify_to_retrieve",
    };
};
