/**
 * 对外链接 guard：仅当 Intake LLM 已声明 external_link 时规范化路由；
 * 结构上过期的多槽 plan 收束为单槽；编号多问拆 entity 槽。
 */
import type {
    IntakeRetrievalPlanItem,
    IntakeRoutingDecision,
} from "@/agentflow/brain-service/online/intake-coordinator/contract";
import { EXTERNAL_LINK_SLOT } from "@/agentflow/brain-service/online/intake-coordinator/composite";
import {
    decisionRequestsExternalLink,
    extractNumberedPlanUnits,
    hasExplicitMultipartStructure,
    hasStaleMultipartFromDecision,
} from "../query-signals";

export type IntakeLinkLookupGuardReason =
    | "noop"
    | "single_external_link"
    | "aggregate_external_link"
    | "multipart_external_link"
    | "harmonize_query_type";

const buildEntityExternalLinkQuery = (label: string): string => {
    const entity = label.trim();
    if (!entity) return EXTERNAL_LINK_SLOT.searchQuery;
    return `${entity} ${EXTERNAL_LINK_SLOT.searchQuery}`;
};

const buildExternalLinkPlan = (
    userQuestion: string
): IntakeRetrievalPlanItem[] => {
    const units = extractNumberedPlanUnits(userQuestion);
    return units.map((label) => ({
        label,
        searchQuery: buildEntityExternalLinkQuery(label),
        queryType: "external_link" as const,
        topics: [...EXTERNAL_LINK_SLOT.topics],
    }));
};

export const applyIntakeLinkLookupGuard = (
    decision: IntakeRoutingDecision,
    userQuestion: string
): IntakeRoutingDecision & { linkLookupGuardReason?: IntakeLinkLookupGuardReason } => {
    if (decision.intent !== "retrieve_and_answer") {
        return { ...decision, linkLookupGuardReason: "noop" };
    }

    if (!decisionRequestsExternalLink(decision)) {
        return { ...decision, linkLookupGuardReason: "noop" };
    }

    if (hasStaleMultipartFromDecision(decision, userQuestion)) {
        return {
            ...decision,
            queryType: "external_link",
            searchQuery: EXTERNAL_LINK_SLOT.searchQuery,
            topics: [...EXTERNAL_LINK_SLOT.topics],
            subTasks: [EXTERNAL_LINK_SLOT.label],
            retrievalPlan: [],
            linkLookupGuardReason: "aggregate_external_link",
        };
    }

    if (hasExplicitMultipartStructure(userQuestion)) {
        const plan = buildExternalLinkPlan(userQuestion);
        if (plan.length >= 2) {
            return {
                ...decision,
                queryType: "external_link",
                searchQuery: plan[0]!.searchQuery,
                topics: [...EXTERNAL_LINK_SLOT.topics],
                subTasks: plan.map((p) => p.label),
                retrievalPlan: plan,
                linkLookupGuardReason: "multipart_external_link",
            };
        }
    }

    if (decision.queryType !== "external_link") {
        return {
            ...decision,
            queryType: "external_link",
            searchQuery:
                decision.searchQuery.trim() || EXTERNAL_LINK_SLOT.searchQuery,
            topics:
                decision.topics.length > 0
                    ? decision.topics
                    : [...EXTERNAL_LINK_SLOT.topics],
            subTasks:
                decision.subTasks.length > 0
                    ? decision.subTasks
                    : [EXTERNAL_LINK_SLOT.label],
            retrievalPlan: decision.retrievalPlan ?? [],
            linkLookupGuardReason: "harmonize_query_type",
        };
    }

    if (!decision.searchQuery.trim()) {
        return {
            ...decision,
            searchQuery: EXTERNAL_LINK_SLOT.searchQuery,
            topics: [...EXTERNAL_LINK_SLOT.topics],
            linkLookupGuardReason: "single_external_link",
        };
    }

    return { ...decision, linkLookupGuardReason: "noop" };
};
