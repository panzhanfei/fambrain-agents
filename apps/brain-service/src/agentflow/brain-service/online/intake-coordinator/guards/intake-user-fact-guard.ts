/**
 * @deprecated pipeline 不再调用；userFact 节点入口使用 routeUserFactFromIntake。
 * 保留供 verify-user-fact 等单测断言 RoutedIntakeDecision 形状。
 */
import type { IntakeRoutingDecision } from "../contract/prompt";
import type { RoutedIntakeDecision } from "../composite/composite-route-guard";
import type { UserFactRoute } from "@/agentflow/brain-service/online/user-fact";

export type { UserFactRoute };

export const buildUserFactRoutedDecision = (
    userFact: UserFactRoute,
    base: IntakeRoutingDecision
): RoutedIntakeDecision => ({
    ...base,
    intent: base.intent,
    needsRetrieval: false,
    clarifyingQuestion: null,
    briefReply: null,
    retrievalPlan: [],
    subTasks: [],
    queryType: null,
    searchQuery: base.searchQuery || "",
    userFact,
    routeMode: "single",
    compositeSlots: [],
    routeReason: "skip_non_retrieve",
    routePlanSource: "none",
});

/** Intake 已识别 user fact 时，短路 composite / KM */
export const applyUserFactFromIntake = (
    decision: IntakeRoutingDecision,
    userFact: UserFactRoute
): RoutedIntakeDecision => buildUserFactRoutedDecision(userFact, decision);
