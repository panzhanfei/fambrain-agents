/**
 * P0-16：Intake 结构化 remember_user_fact / recall_user_fact → userFact 编排分支。
 */
import type { IntakeRoutingDecision } from "./prompt";
import type { RoutedIntakeDecision } from "./composite-route-guard";
import type { UserFactRoute } from "./user-fact";

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
