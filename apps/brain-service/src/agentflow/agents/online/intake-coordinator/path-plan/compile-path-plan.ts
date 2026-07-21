/**
 * 将 RoutedIntakeDecision（compositeSlots / retrievalPlan）编译为 PathPlan + composeMode。
 *
 * 规则（声明式，无场景 if-else）：
 * - enumeration + list_corpus → list
 * - topics.external → tool(search_web)
 * - 其余（identity / external_link / preview enum / …）→ km
 * - topics.external + corpus 并存 → 唯一通用 DAG：多源汇合（hybrid）
 *
 * 槽位回答顺序：始终保留 Intake compositeSlots 顺序，PathPlan 只做执行分桶。
 */
import type { CompositeRetrievalSlot } from "@/agentflow/agents/online/intake-coordinator/composite/interface";
import type { RoutedIntakeDecision } from "@/agentflow/agents/online/intake-coordinator/guards/interface";
import {
  decisionSuggestsHybridDag,
  topicsSuggestWebSource,
} from "@/agentflow/agents/online/tool-orchestrator/field-catalog";
import { enrichCompositeSlots } from "@/agentflow/agents/online/tool-orchestrator";
import { expandHybridMultiSourceTemplate } from "./dag-templates";
import { emptyPathPlan } from "./defaults";
import type {
  ComposeMode,
  DagRun,
  KmStep,
  ListStep,
  PathPlan,
  ToolStep,
} from "./interface";

const countSteps = (plan: PathPlan): number =>
  plan.km.length + plan.list.length + plan.tool.length + plan.dag.length;

const slotToKm = (slot: CompositeRetrievalSlot, index: number): KmStep => ({
  id: String(slot.id || `km-${index}`),
  pathKind: "km",
  label: slot.label,
  searchQuery: slot.searchQuery,
  queryType: slot.queryType,
  topics: [...slot.topics],
  identityField: slot.identityField ?? null,
});

const slotToList = (slot: CompositeRetrievalSlot, index: number): ListStep => ({
  id: String(slot.id || `list-${index}`),
  pathKind: "list",
  label: slot.label,
  searchQuery: slot.searchQuery,
  queryType: "enumeration",
  topics: [...slot.topics],
  identityField: slot.identityField ?? null,
  enumerationControl: slot.enumerationControl ?? null,
  enumerationPage: slot.enumerationPage,
  enumerationPageSize: slot.enumerationPageSize,
});

const resolveComposeMode = (
  decision: RoutedIntakeDecision,
  plan: PathPlan
): ComposeMode => {
  if (decision.intent === "summarize_content") return "summarize";
  if (countSteps(plan) >= 2) return "composite";
  return "qa";
};

/**
 * 从 compositeSlots / topics 编译 PathPlan（分桶，不重排回答顺序）。
 */
export const compilePathPlan = (
  decision: RoutedIntakeDecision,
  _userQuestion: string
): { pathPlan: PathPlan; composeMode: ComposeMode } => {
  if (decision.intent !== "retrieve_and_answer") {
    if (decision.intent === "summarize_content") {
      const km: KmStep[] =
        decision.searchQuery.trim().length > 0
          ? [
              {
                id: "km-0",
                pathKind: "km",
                label: "摘要检索",
                searchQuery: decision.searchQuery,
                queryType: decision.queryType ?? "default",
                topics: [...decision.topics],
              },
            ]
          : [];
      return {
        pathPlan: { ...emptyPathPlan(), km },
        composeMode: "summarize",
      };
    }
    return { pathPlan: emptyPathPlan(), composeMode: "qa" };
  }

  const slots = decision.compositeSlots ?? [];
  const planTopics = (decision.retrievalPlan ?? []).map((p) => p.topics);
  const hybrid = decisionSuggestsHybridDag({
    topics: decision.topics,
    planTopics,
  });

  if (hybrid) {
    const pathPlan: PathPlan = {
      ...emptyPathPlan(),
      dag: [
        {
          id: "dag-hybrid",
          pathKind: "dag",
          label: "多源综合评估",
          template: "hybrid_multi_source",
          deps: [],
        },
      ],
    };
    return { pathPlan, composeMode: "qa" };
  }

  const km: KmStep[] = [];
  const list: ListStep[] = [];
  const tool: ToolStep[] = [];
  const dag: DagRun[] = [];

  let listIndex = 0;
  let kmIndex = 0;

  for (const slot of slots) {
    const isList =
      slot.queryType === "enumeration" && slot.executor === "list_corpus";

    if (isList) {
      list.push(slotToList(slot, listIndex++));
      continue;
    }

    if (topicsSuggestWebSource(slot.topics)) {
      tool.push({
        id: String(slot.id || `tool-${tool.length}`),
        pathKind: "tool",
        label: slot.label,
        searchQuery: slot.searchQuery,
        queryType: slot.queryType,
        topics: [...slot.topics],
        identityField: slot.identityField ?? null,
        toolId: "search_web",
        dataSource: "web",
      });
      continue;
    }

    // identity / external_link / preview enumeration / default → km
    // compute 工具在 retrieve 后由 toolId 触发；仍记入 km 取 hits
    km.push(slotToKm(slot, kmIndex++));
  }

  // 顶层 topics 声明 web 且尚无 tool 槽
  if (
    tool.length === 0 &&
    topicsSuggestWebSource(decision.topics) &&
    km.length + list.length + dag.length > 0
  ) {
    tool.push({
      id: "tool-web",
      pathKind: "tool",
      label: "外部检索",
      searchQuery: decision.searchQuery || _userQuestion,
      queryType: decision.queryType ?? "default",
      topics: [...decision.topics],
      toolId: "search_web",
      dataSource: "web",
    });
  }

  const pathPlan: PathPlan = { km, list, tool, dag };
  return {
    pathPlan,
    composeMode: resolveComposeMode(decision, pathPlan),
  };
};

/** pathPlan → compositeSlots（仅 Intake 未给槽时的兜底；顺序：list→km） */
export const pathPlanToCompositeSlots = (
  plan: PathPlan
): CompositeRetrievalSlot[] => {
  const slots: CompositeRetrievalSlot[] = [];

  for (const s of plan.list) {
    slots.push({
      id: s.id,
      label: s.label,
      searchQuery: s.searchQuery,
      queryType: "enumeration",
      topics: s.topics,
      subTasks: [s.label],
      executor: "list_corpus",
      enumerationControl: s.enumerationControl ?? null,
      identityField: s.identityField ?? null,
      enumerationPage: s.enumerationPage,
      enumerationPageSize: s.enumerationPageSize,
    });
  }

  for (const s of plan.km) {
    slots.push({
      id: s.id,
      label: s.label,
      searchQuery: s.searchQuery,
      queryType: s.queryType,
      topics: s.topics,
      subTasks: [s.label],
      executor: "km_retrieve",
      identityField: s.identityField ?? null,
    });
  }

  return slots;
};

const normalizeSlotForPathPlan = (
  slot: CompositeRetrievalSlot
): CompositeRetrievalSlot => ({
  ...slot,
  executor: slot.executor ?? "km_retrieve",
  enumerationControl:
    slot.queryType === "enumeration" ? (slot.enumerationControl ?? null) : null,
});

/**
 * Intake guard ⑨：编译执行四桶 PathPlan + composeMode。
 *
 * 本步新增/改写：
 *   + pathPlan.km / .list / .tool / .dag（分桶，不重排回答顺序）
 *   + composeMode（qa | summarize | composite）
 *   Δ compositeSlots（normalize executor + enrich）
 *   Δ routeMode（hybrid → dag，否则有活则 slots）
 *   + executionPlan（若 hybrid 且此前未建）
 *
 * 规则摘要：list_corpus→list；topics.external→tool/web；其余→km；
 * external+corpus→唯一 DAG hybrid_multi_source。
 */
export const applyPathPlanGuard = (
  decision: RoutedIntakeDecision,
  userQuestion: string
): RoutedIntakeDecision => {
  const { pathPlan, composeMode } = compilePathPlan(decision, userQuestion);
  const hasWork = countSteps(pathPlan) > 0;
  const isHybrid = pathPlan.dag.some(
    (d) => d.template === "hybrid_multi_source"
  );

  // 回答顺序 = Intake compositeSlots 顺序；PathPlan 仅分桶，不重排
  const orderedSlots =
    (decision.compositeSlots?.length ?? 0) > 0
      ? decision.compositeSlots!.map(normalizeSlotForPathPlan)
      : pathPlanToCompositeSlots(pathPlan);

  const enrichedSlots = enrichCompositeSlots(orderedSlots);

  return {
    ...decision,
    pathPlan,
    composeMode,
    compositeSlots: enrichedSlots,
    routeMode: hasWork ? (isHybrid ? "dag" : "slots") : decision.routeMode,
    executionPlan: isHybrid
      ? (decision.executionPlan ??
        expandHybridMultiSourceTemplate(userQuestion, decision.searchQuery))
      : decision.executionPlan,
  };
};
