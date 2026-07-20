/**
 * 对外链接 guard：规范化 external_link 路由；
 * 保留 enumeration + external_link 混合 plan；过期多槽收束；编号多问拆实体槽。
 * 纠偏仅用结构化信号（sibling queryType / 顶层 queryType + topics），不调口语词表。
 */
import type {
    IntakeRetrievalPlanItem,
    IntakeRoutingDecision,
} from "@/agentflow/agents/online/intake-coordinator/contract";
import { EXTERNAL_LINK_SLOT } from "@/agentflow/agents/online/intake-coordinator/composite";
import {
    decisionRequestsExternalLink,
    extractNumberedPlanUnits,
    hasExplicitMultipartStructure,
    hasStaleMultipartFromDecision,
} from "../signals";

export type IntakeLinkLookupGuardReason =
    | "noop"
    | "single_external_link"
    | "aggregate_external_link"
    | "multipart_external_link"
    | "preserve_mixed_plan"
    | "harmonize_plan_query_types"
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

const planHasMixedQueryTypes = (
    plan: IntakeRetrievalPlanItem[]
): boolean => {
    const types = new Set(plan.map((p) => p.queryType));
    return types.size >= 2;
};

const planHasEnumerationAndLink = (
    plan: IntakeRetrievalPlanItem[]
): boolean => {
    const types = new Set(plan.map((p) => p.queryType));
    return types.has("enumeration") && types.has("external_link");
};

const topicsSuggestPersonalResume = (topics: string[]): boolean =>
    topics.includes("personal") || topics.includes("resume");

/**
 * 结构化纠偏：顶层已声明 external_link，且 plan 项误标 enumeration、
 * topics 含 personal/resume 时改回 external_link。
 * 已有 enumeration+external_link 混合 plan 时不改（保留列举槽）。
 */
export const harmonizeRetrievalPlanQueryTypes = (
    plan: IntakeRetrievalPlanItem[],
    topQueryType?: IntakeRoutingDecision["queryType"]
): { plan: IntakeRetrievalPlanItem[]; changed: boolean } => {
    if (topQueryType !== "external_link") {
        return { plan, changed: false };
    }
    if (planHasEnumerationAndLink(plan)) {
        return { plan, changed: false };
    }

    let changed = false;
    const next = plan.map((item) => {
        if (item.queryType !== "enumeration") return item;
        if (!topicsSuggestPersonalResume(item.topics)) return item;
        changed = true;
        return {
            ...item,
            queryType: "external_link" as const,
            topics:
                item.topics.length > 0
                    ? item.topics
                    : [...EXTERNAL_LINK_SLOT.topics],
            enumerationControl: null,
            searchQuery: item.searchQuery.trim()
                ? `${item.searchQuery.trim()} ${EXTERNAL_LINK_SLOT.searchQuery}`
                : EXTERNAL_LINK_SLOT.searchQuery,
        };
    });
    return { plan: next, changed };
};

export const applyIntakeLinkLookupGuard = (
    decision: IntakeRoutingDecision,
    userQuestion: string
): IntakeRoutingDecision & { linkLookupGuardReason?: IntakeLinkLookupGuardReason } => {
    /** 步骤 1：非 retrieve 意图 → 不处理外链 */
    if (decision.intent !== "retrieve_and_answer") {
        return { ...decision, linkLookupGuardReason: "noop" };
    }

    /**
     * 步骤 2：plan 内误标 enumeration 的链接项 → 改 external_link。
     * 条件：顶层 queryType 已是 external_link；已有 enum+link 混合 plan 则不动。
     */
    const rawPlan = decision.retrievalPlan ?? [];
    const { plan: harmonizedPlan, changed: planHarmonized } =
        harmonizeRetrievalPlanQueryTypes(rawPlan, decision.queryType);
    let working: IntakeRoutingDecision = planHarmonized
        ? {
              ...decision,
              retrievalPlan: harmonizedPlan,
              queryType: planHasEnumerationAndLink(harmonizedPlan)
                  ? decision.queryType
                  : harmonizedPlan.some((p) => p.queryType === "external_link")
                    ? "external_link"
                    : decision.queryType,
          }
        : decision;

    /**
     * 步骤 3：decision/plan 未声明外链需求 → 仅返回步骤 2 的 harmonize 结果（或 noop）。
     * 外链信号：queryType=external_link 或 retrievalPlan 含该类型。
     */
    if (!decisionRequestsExternalLink(working)) {
        return {
            ...working,
            linkLookupGuardReason: planHarmonized
                ? "harmonize_plan_query_types"
                : "noop",
        };
    }

    const plan = working.retrievalPlan ?? [];

    /**
     * 步骤 4：混合多问 plan（如 列举 + GitHub 链接）→ 保留多槽，不收成单槽。
     */
    if (plan.length >= 2 && planHasMixedQueryTypes(plan)) {
        return {
            ...working,
            retrievalPlan: plan,
            linkLookupGuardReason: planHarmonized
                ? "harmonize_plan_query_types"
                : "preserve_mixed_plan",
        };
    }

    /**
     * 步骤 5：过期多槽 — LLM 留了多 plan，但当前问句并非多问结构 → 收成单槽外链检索。
     */
    if (hasStaleMultipartFromDecision(working, userQuestion)) {
        return {
            ...working,
            queryType: "external_link",
            searchQuery: EXTERNAL_LINK_SLOT.searchQuery,
            topics: [...EXTERNAL_LINK_SLOT.topics],
            subTasks: [EXTERNAL_LINK_SLOT.label],
            retrievalPlan: [],
            linkLookupGuardReason: "aggregate_external_link",
        };
    }

    /**
     * 步骤 6：当前问句带编号多问（1. xxx 2. yyy）→ 按实体拆多条 external_link plan。
     */
    if (hasExplicitMultipartStructure(userQuestion)) {
        const numberedPlan = buildExternalLinkPlan(userQuestion);
        if (numberedPlan.length >= 2) {
            return {
                ...working,
                queryType: "external_link",
                searchQuery: numberedPlan[0]!.searchQuery,
                topics: [...EXTERNAL_LINK_SLOT.topics],
                subTasks: numberedPlan.map((p) => p.label),
                retrievalPlan: numberedPlan,
                linkLookupGuardReason: "multipart_external_link",
            };
        }
    }

    /**
     * 步骤 7：已判定外链但 queryType 未对齐 → 补 external_link + searchQuery/topics/subTasks。
     */
    if (working.queryType !== "external_link") {
        return {
            ...working,
            queryType: "external_link",
            searchQuery:
                working.searchQuery.trim() || EXTERNAL_LINK_SLOT.searchQuery,
            topics:
                working.topics.length > 0
                    ? working.topics
                    : [...EXTERNAL_LINK_SLOT.topics],
            subTasks:
                working.subTasks.length > 0
                    ? working.subTasks
                    : [EXTERNAL_LINK_SLOT.label],
            retrievalPlan: working.retrievalPlan ?? [],
            linkLookupGuardReason: "harmonize_query_type",
        };
    }

    /** 步骤 8：已是 external_link 但 searchQuery 空 → 填固定外链检索词 */
    if (!working.searchQuery.trim()) {
        return {
            ...working,
            searchQuery: EXTERNAL_LINK_SLOT.searchQuery,
            topics: [...EXTERNAL_LINK_SLOT.topics],
            linkLookupGuardReason: "single_external_link",
        };
    }

    /** 步骤 9：无需再改；若步骤 2 harmonize 过则记 reason */
    return {
        ...working,
        linkLookupGuardReason: planHarmonized
            ? "harmonize_plan_query_types"
            : "noop",
    };
};
