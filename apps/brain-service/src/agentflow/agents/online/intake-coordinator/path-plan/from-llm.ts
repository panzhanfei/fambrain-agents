/**
 * LLM PathPlan → 合法化 + 派生 compositeSlots / retrievalPlan。
 * 不做 queryType 猜桶；空 plan → 由上层 clarify。
 */
import type { IntakeRoutingDecision } from "@/agentflow/agents/online/intake-coordinator/contract";
import type { CompositeRetrievalSlot } from "@/agentflow/agents/online/intake-coordinator/composite/interface";
import type { EnumerationControl } from "@/agentflow/agents/online/intake-coordinator/enumeration";
import {
  ENUMERATION_EXHAUSTIVE_PAGE_SIZE,
} from "@/agentflow/agents/online/corpus-lister/list";
import type { CompositeSessionKey } from "@fambrain/infra";
import { getEnumerationListSession } from "@fambrain/infra";
import {
  TOOL_RUN_IDS,
  type DataSource,
  type ToolRunId,
} from "@/agentflow/agents/online/tool-orchestrator";
import { expandHybridMultiSourceTemplate } from "./dag-templates";
import { emptyPathPlan, defaultComposeMode } from "./defaults";
import type {
  ComposeMode,
  DagRun,
  KmStep,
  ListStep,
  PathPlan,
  ToolStep,
} from "./interface";

const TOOL_ID_SET = new Set<string>(TOOL_RUN_IDS);

const QUERY_TYPES = new Set([
  "identity",
  "enumeration",
  "tech",
  "external_link",
  "default",
]);

const DATA_SOURCES = new Set(["corpus", "web", "compute", "synthesize"]);

const asQueryType = (
  v: unknown
): KmStep["queryType"] => {
  if (typeof v === "string" && QUERY_TYPES.has(v)) {
    return v as KmStep["queryType"];
  }
  return "default";
};

const asToolId = (v: unknown): ToolRunId | null => {
  if (typeof v === "string" && TOOL_ID_SET.has(v)) return v as ToolRunId;
  return null;
};

const asDataSource = (v: unknown): DataSource | null => {
  if (typeof v === "string" && DATA_SOURCES.has(v)) return v as DataSource;
  return null;
};

const trimId = (v: unknown, fallback: string): string => {
  const s = typeof v === "string" ? v.trim() : "";
  return s || fallback;
};

const countSteps = (plan: PathPlan): number =>
  plan.km.length + plan.list.length + plan.tool.length + plan.dag.length;

export const isPathPlanEmpty = (plan: PathPlan | null | undefined): boolean =>
  !plan || countSteps(plan) === 0;

const legalizeKm = (raw: unknown, index: number): KmStep | null => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const label = String(o.label ?? "").trim();
  const searchQuery = String(o.searchQuery ?? o.search_query ?? "").trim();
  if (!label && !searchQuery) return null;
  return {
    id: trimId(o.id, `km-${index}`),
    pathKind: "km",
    label: label || searchQuery.slice(0, 40) || `km-${index}`,
    searchQuery: searchQuery || label,
    queryType: asQueryType(o.queryType ?? o.query_type),
    topics: Array.isArray(o.topics)
      ? o.topics.map((t) => String(t).trim()).filter(Boolean)
      : [],
    identityField:
      typeof o.identityField === "string" || o.identityField === null
        ? (o.identityField as KmStep["identityField"])
        : typeof o.identity_field === "string"
          ? (o.identity_field as KmStep["identityField"])
          : null,
    toolId: asToolId(o.toolId ?? o.tool_id),
    dataSource: asDataSource(o.dataSource ?? o.data_source),
  };
};

const legalizeList = (raw: unknown, index: number): ListStep | null => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const label = String(o.label ?? "").trim();
  const searchQuery = String(o.searchQuery ?? o.search_query ?? "").trim();
  if (!label && !searchQuery) return null;
  const controlRaw = o.enumerationControl ?? o.enumeration_control;
  let enumerationControl: EnumerationControl | null = null;
  if (controlRaw && typeof controlRaw === "object" && !Array.isArray(controlRaw)) {
    const c = controlRaw as Record<string, unknown>;
    const action = c.action;
    const listKind = c.listKind ?? c.list_kind;
    if (
      (action === "preview" || action === "continue" || action === "exhaustive") &&
      (listKind === "project" || listKind === "experience")
    ) {
      enumerationControl = {
        action,
        listKind,
        excludeHint:
          typeof c.excludeHint === "string"
            ? c.excludeHint.trim() || null
            : typeof c.exclude_hint === "string"
              ? String(c.exclude_hint).trim() || null
              : null,
        timeWindowYears:
          typeof c.timeWindowYears === "number"
            ? c.timeWindowYears
            : typeof c.time_window_years === "number"
              ? c.time_window_years
              : null,
      };
    }
  }
  return {
    id: trimId(o.id, `list-${index}`),
    pathKind: "list",
    label: label || searchQuery.slice(0, 40) || `list-${index}`,
    searchQuery: searchQuery || label,
    queryType: "enumeration",
    topics: Array.isArray(o.topics)
      ? o.topics.map((t) => String(t).trim()).filter(Boolean)
      : ["project"],
    identityField: null,
    enumerationControl,
    enumerationPage:
      typeof o.enumerationPage === "number" ? o.enumerationPage : undefined,
    enumerationPageSize:
      typeof o.enumerationPageSize === "number"
        ? o.enumerationPageSize
        : undefined,
  };
};

const legalizeTool = (raw: unknown, index: number): ToolStep | null => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const toolId = asToolId(o.toolId ?? o.tool_id);
  if (!toolId) return null;
  const label = String(o.label ?? "").trim();
  const searchQuery = String(o.searchQuery ?? o.search_query ?? "").trim();
  const dataSource =
    asDataSource(o.dataSource ?? o.data_source) ??
    (toolId === "search_web" ? "web" : "corpus");
  return {
    id: trimId(o.id, `tool-${index}`),
    pathKind: "tool",
    label: label || toolId,
    searchQuery: searchQuery || label || toolId,
    queryType: asQueryType(o.queryType ?? o.query_type),
    topics: Array.isArray(o.topics)
      ? o.topics.map((t) => String(t).trim()).filter(Boolean)
      : [],
    identityField: null,
    toolId,
    dataSource,
  };
};

const legalizeDag = (raw: unknown, index: number): DagRun | null => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (o.template !== "hybrid_multi_source") return null;
  return {
    id: trimId(o.id, `dag-${index}`),
    pathKind: "dag",
    label: String(o.label ?? "多源综合评估").trim() || "多源综合评估",
    template: "hybrid_multi_source",
    deps: Array.isArray(o.deps)
      ? o.deps.map((d) => String(d).trim()).filter(Boolean)
      : [],
    params:
      o.params && typeof o.params === "object" && !Array.isArray(o.params)
        ? (o.params as Record<string, unknown>)
        : undefined,
  };
};

/** 合法化 LLM pathPlan；非法项丢弃 */
export const legalizePathPlan = (raw: unknown): PathPlan => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return emptyPathPlan();
  }
  const o = raw as Record<string, unknown>;
  const kmIn = Array.isArray(o.km) ? o.km : [];
  const listIn = Array.isArray(o.list) ? o.list : [];
  const toolIn = Array.isArray(o.tool) ? o.tool : [];
  const dagIn = Array.isArray(o.dag) ? o.dag : [];
  return {
    km: kmIn
      .map((item, i) => legalizeKm(item, i))
      .filter((x): x is KmStep => Boolean(x)),
    list: listIn
      .map((item, i) => legalizeList(item, i))
      .filter((x): x is ListStep => Boolean(x)),
    tool: toolIn
      .map((item, i) => legalizeTool(item, i))
      .filter((x): x is ToolStep => Boolean(x)),
    dag: dagIn
      .map((item, i) => legalizeDag(item, i))
      .filter((x): x is DagRun => Boolean(x)),
  };
};

export const legalizeComposeMode = (
  raw: unknown,
  plan: PathPlan
): ComposeMode => {
  if (raw === "qa" || raw === "summarize" || raw === "composite") return raw;
  if (countSteps(plan) >= 2) return "composite";
  return defaultComposeMode();
};

export const legalizeAnswerOrder = (
  raw: unknown,
  plan: PathPlan
): string[] => {
  const allIds = [
    ...plan.km.map((s) => s.id),
    ...plan.list.map((s) => s.id),
    ...plan.tool.map((s) => s.id),
    ...plan.dag.map((s) => s.id),
  ];
  const idSet = new Set(allIds);
  const fromLlm = Array.isArray(raw)
    ? raw
        .map((x) => String(x).trim())
        .filter((id) => id && idSet.has(id))
    : [];
  if (fromLlm.length > 0) {
    const missing = allIds.filter((id) => !fromLlm.includes(id));
    return [...fromLlm, ...missing];
  }
  return allIds;
};

const stepById = (
  plan: PathPlan
): Map<string, KmStep | ListStep | ToolStep | DagRun> => {
  const m = new Map<string, KmStep | ListStep | ToolStep | DagRun>();
  for (const s of plan.km) m.set(s.id, s);
  for (const s of plan.list) m.set(s.id, s);
  for (const s of plan.tool) m.set(s.id, s);
  for (const s of plan.dag) m.set(s.id, s);
  return m;
};

/** list 步补 session 页码（运行时状态，非 LLM） */
export const fillListPagesInPathPlan = async (
  plan: PathPlan,
  session: CompositeSessionKey
): Promise<PathPlan> => {
  const list = await Promise.all(
    plan.list.map(async (step) => {
      const control = step.enumerationControl;
      if (!control) {
        return {
          ...step,
          enumerationPage: step.enumerationPage ?? 1,
          enumerationPageSize:
            step.enumerationPageSize ?? ENUMERATION_EXHAUSTIVE_PAGE_SIZE,
        };
      }
      if (control.action === "exhaustive") {
        return {
          ...step,
          enumerationPage: 1,
          enumerationPageSize:
            step.enumerationPageSize ?? ENUMERATION_EXHAUSTIVE_PAGE_SIZE,
        };
      }
      if (control.action === "continue") {
        const stored = await getEnumerationListSession(
          session,
          control.listKind
        );
        return {
          ...step,
          enumerationPage: (stored?.lastPage ?? 1) + 1,
          enumerationPageSize:
            stored?.pageSize ??
            step.enumerationPageSize ??
            ENUMERATION_EXHAUSTIVE_PAGE_SIZE,
        };
      }
      return {
        ...step,
        enumerationPage: step.enumerationPage ?? 1,
        enumerationPageSize:
          step.enumerationPageSize ?? ENUMERATION_EXHAUSTIVE_PAGE_SIZE,
      };
    })
  );
  return { ...plan, list };
};

/** 按 answerOrder 派生 compositeSlots（dag 不进槽） */
export const deriveCompositeSlotsFromPathPlan = (
  plan: PathPlan,
  answerOrder: string[]
): CompositeRetrievalSlot[] => {
  const byId = stepById(plan);
  const slots: CompositeRetrievalSlot[] = [];
  for (const id of answerOrder) {
    const step = byId.get(id);
    if (!step || step.pathKind === "dag") continue;
    if (step.pathKind === "list") {
      const listStep = step as ListStep;
      const isListAction =
        listStep.enumerationControl?.action === "continue" ||
        listStep.enumerationControl?.action === "exhaustive";
      slots.push({
        id: listStep.id,
        label: listStep.label,
        searchQuery: listStep.searchQuery,
        queryType: "enumeration",
        topics: [...listStep.topics],
        subTasks: [listStep.label],
        executor: isListAction ? "list_corpus" : "km_retrieve",
        enumerationControl: listStep.enumerationControl ?? null,
        identityField: null,
        enumerationPage: listStep.enumerationPage,
        enumerationPageSize: listStep.enumerationPageSize,
        toolId: null,
        dataSource: "corpus",
      });
      continue;
    }
    if (step.pathKind === "tool") {
      const toolStep = step as ToolStep;
      slots.push({
        id: toolStep.id,
        label: toolStep.label,
        searchQuery: toolStep.searchQuery,
        queryType: toolStep.queryType,
        topics: [...toolStep.topics],
        subTasks: [toolStep.label],
        executor: "km_retrieve",
        enumerationControl: null,
        identityField: null,
        toolId: toolStep.toolId,
        dataSource: toolStep.dataSource,
      });
      continue;
    }
    const km = step as KmStep;
    slots.push({
      id: km.id,
      label: km.label,
      searchQuery: km.searchQuery,
      queryType: km.queryType,
      topics: [...km.topics],
      subTasks: [km.label],
      executor: "km_retrieve",
      enumerationControl: null,
      identityField: km.identityField ?? null,
      toolId: km.toolId ?? null,
      dataSource: km.dataSource ?? "corpus",
    });
  }
  return slots;
};

export const deriveRetrievalPlanFromPathPlan = (
  plan: PathPlan,
  answerOrder: string[]
): IntakeRoutingDecision["retrievalPlan"] => {
  const byId = stepById(plan);
  const out: IntakeRoutingDecision["retrievalPlan"] = [];
  for (const id of answerOrder) {
    const step = byId.get(id);
    if (!step || step.pathKind === "dag") continue;
    if (step.pathKind === "list") {
      const listStep = step as ListStep;
      out.push({
        label: listStep.label,
        searchQuery: listStep.searchQuery,
        queryType: "enumeration",
        topics: [...listStep.topics],
        enumerationControl: listStep.enumerationControl ?? null,
        identityField: null,
      });
      continue;
    }
    if (step.pathKind === "tool") {
      const toolStep = step as ToolStep;
      out.push({
        label: toolStep.label,
        searchQuery: toolStep.searchQuery,
        queryType: toolStep.queryType,
        topics: [...toolStep.topics],
        enumerationControl: null,
        identityField: null,
      });
      continue;
    }
    const km = step as KmStep;
    out.push({
      label: km.label,
      searchQuery: km.searchQuery,
      queryType: km.queryType,
      topics: [...km.topics],
      enumerationControl: null,
      identityField: km.identityField ?? null,
    });
  }
  return out;
};

/** hybrid dag → executionPlan 模板展开 */
export const executionPlanFromPathPlanDag = (
  plan: PathPlan,
  userQuestion: string,
  searchQuery: string
) => {
  const hybrid = plan.dag.find((d) => d.template === "hybrid_multi_source");
  if (!hybrid) return undefined;
  return expandHybridMultiSourceTemplate(userQuestion, searchQuery);
};
