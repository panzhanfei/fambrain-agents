/**
 * 对外链接 guard：结构化纠偏（harmonize / 保留混合 plan）。
 * 不发明 multipart plan、不按问句编号拆槽（由 LLM 写齐 retrievalPlan）。
 */
import type {
  IntakeRetrievalPlanItem,
  IntakeRoutingDecision,
} from "@/agentflow/agents/online/intake-coordinator/contract";
import { EXTERNAL_LINK_SLOT } from "@/agentflow/agents/online/intake-coordinator/composite";
import { decisionRequestsExternalLink } from "../signals";

export type IntakeLinkLookupGuardReason =
  | "noop"
  | "single_external_link"
  | "preserve_mixed_plan"
  | "harmonize_plan_query_types"
  | "harmonize_query_type";

const planHasMixedQueryTypes = (plan: IntakeRetrievalPlanItem[]): boolean => {
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
        item.topics.length > 0 ? item.topics : [...EXTERNAL_LINK_SLOT.topics],
      enumerationControl: null,
      searchQuery: item.searchQuery.trim()
        ? item.searchQuery.trim()
        : EXTERNAL_LINK_SLOT.searchQuery,
    };
  });
  return { plan: next, changed };
};

const fillEmptyExternalLinkQueries = (
  plan: IntakeRetrievalPlanItem[]
): { plan: IntakeRetrievalPlanItem[]; changed: boolean } => {
  let changed = false;
  const next = plan.map((item) => {
    if (item.queryType !== "external_link") return item;
    if (item.searchQuery.trim()) return item;
    changed = true;
    return {
      ...item,
      searchQuery: EXTERNAL_LINK_SLOT.searchQuery,
      topics:
        item.topics.length > 0 ? item.topics : [...EXTERNAL_LINK_SLOT.topics],
    };
  });
  return { plan: next, changed };
};

export const applyIntakeLinkLookupGuard = (
  decision: IntakeRoutingDecision,
  _userQuestion: string
): IntakeRoutingDecision & {
  linkLookupGuardReason?: IntakeLinkLookupGuardReason;
} => {
  if (decision.intent !== "retrieve_and_answer") {
    return { ...decision, linkLookupGuardReason: "noop" };
  }

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

  if (!decisionRequestsExternalLink(working)) {
    return {
      ...working,
      linkLookupGuardReason: planHarmonized
        ? "harmonize_plan_query_types"
        : "noop",
    };
  }

  const plan = working.retrievalPlan ?? [];

  if (plan.length >= 2 && planHasMixedQueryTypes(plan)) {
    const filled = fillEmptyExternalLinkQueries(plan);
    return {
      ...working,
      retrievalPlan: filled.plan,
      linkLookupGuardReason: planHarmonized
        ? "harmonize_plan_query_types"
        : "preserve_mixed_plan",
    };
  }

  if (working.queryType !== "external_link") {
    const filled = fillEmptyExternalLinkQueries(working.retrievalPlan ?? []);
    return {
      ...working,
      queryType: "external_link",
      searchQuery: working.searchQuery.trim() || EXTERNAL_LINK_SLOT.searchQuery,
      topics:
        working.topics.length > 0
          ? working.topics
          : [...EXTERNAL_LINK_SLOT.topics],
      subTasks:
        working.subTasks.length > 0
          ? working.subTasks
          : [EXTERNAL_LINK_SLOT.label],
      retrievalPlan: filled.plan,
      linkLookupGuardReason: "harmonize_query_type",
    };
  }

  const filled = fillEmptyExternalLinkQueries(working.retrievalPlan ?? []);
  if (!working.searchQuery.trim()) {
    return {
      ...working,
      searchQuery: EXTERNAL_LINK_SLOT.searchQuery,
      topics:
        working.topics.length > 0
          ? working.topics
          : [...EXTERNAL_LINK_SLOT.topics],
      retrievalPlan: filled.plan,
      linkLookupGuardReason: "single_external_link",
    };
  }

  if (filled.changed) {
    return {
      ...working,
      retrievalPlan: filled.plan,
      linkLookupGuardReason: "single_external_link",
    };
  }

  return {
    ...working,
    linkLookupGuardReason: planHarmonized
      ? "harmonize_plan_query_types"
      : "noop",
  };
};
