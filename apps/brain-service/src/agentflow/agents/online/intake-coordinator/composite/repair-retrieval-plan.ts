/**
 * retrievalPlan 兜底：schema 合法化 + 按结构化 facet 去重。
 * 禁止口语 labels / 问句词表猜意图（合并拆分由 Intake LLM 负责）。
 */
import type {
  IntakeIdentityField,
  IntakeRetrievalPlanItem,
} from "@/agentflow/agents/online/intake-coordinator/contract";
import {
  EMPLOYERS_SLOT,
  EXTERNAL_LINK_SLOT,
  PROJECTS_SLOT,
} from "./composite-slot-queries";
import {
  IDENTITY_FIELD_SEARCH,
  type IdentityFieldSearchSpec,
} from "./identity-field-search";

export type { IdentityFieldSearchSpec };
export { IDENTITY_FIELD_SEARCH };

/** 结构化 facet key：同 key 合并，时间窗不同则并存 */
export const planFacetKey = (item: IntakeRetrievalPlanItem): string => {
  const tw = item.enumerationControl?.timeWindowYears;
  return [
    item.queryType,
    item.identityField ?? "",
    item.enumerationControl?.listKind ?? "",
    tw != null && tw > 0 ? `y${tw}` : "",
  ].join("|");
};

const preferAction = (
  a: "preview" | "continue" | "exhaustive" | undefined,
  b: "preview" | "continue" | "exhaustive" | undefined
): "preview" | "continue" | "exhaustive" => {
  const rank = { preview: 0, continue: 1, exhaustive: 2 } as const;
  const left = a && a in rank ? rank[a] : -1;
  const right = b && b in rank ? rank[b] : -1;
  if (right > left) return b ?? "preview";
  return a ?? "preview";
};

/**
 * 按 facet 去重；冲突时保留更强 enumeration action / 非空 excludeHint / 较短 label。
 */
export const dedupePlanByFacet = (
  items: IntakeRetrievalPlanItem[]
): IntakeRetrievalPlanItem[] => {
  const byKey = new Map<string, IntakeRetrievalPlanItem>();
  for (const item of items) {
    const key = planFacetKey(item);
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, item);
      continue;
    }
    if (item.queryType === "enumeration" || prev.queryType === "enumeration") {
      const action = preferAction(
        prev.enumerationControl?.action,
        item.enumerationControl?.action
      );
      const excludeHint =
        prev.enumerationControl?.excludeHint ??
        item.enumerationControl?.excludeHint ??
        null;
      const timeWindowYears =
        prev.enumerationControl?.timeWindowYears ??
        item.enumerationControl?.timeWindowYears ??
        null;
      const listKind =
        prev.enumerationControl?.listKind ??
        item.enumerationControl?.listKind ??
        "project";
      const label =
        prev.label.length <= item.label.length ? prev.label : item.label;
      byKey.set(key, {
        ...prev,
        label,
        searchQuery: prev.searchQuery || item.searchQuery,
        topics: prev.topics.length > 0 ? prev.topics : [...item.topics],
        enumerationControl: {
          action,
          listKind,
          excludeHint,
          timeWindowYears,
        },
      });
      continue;
    }
    // identity / 其它：保留已有 identityField 更完整的一项
    if (!prev.identityField && item.identityField) {
      byKey.set(key, item);
    }
  }
  return [...byKey.values()];
};

/** 用 schema 字段补齐 searchQuery / enumerationControl（不猜问句） */
export const normalizePlanItemFromSchema = (
  item: IntakeRetrievalPlanItem
): IntakeRetrievalPlanItem => {
  // 结构化字段回填 queryType（LLM 常写出 identityField 却标成 default）
  let queryType = item.queryType;
  let identityField = item.identityField ?? null;
  // timeline→identity 且无 field 时：从业年限类 label 由 LLM 应填 tenure；此处不口语猜，仅保留 identity 检索
  if (item.identityField && queryType !== "identity") {
    queryType = "identity";
  } else if (
    item.enumerationControl?.listKind &&
    queryType !== "enumeration" &&
    queryType !== "external_link" &&
    queryType !== "tech"
  ) {
    queryType = "enumeration";
  }

  if (queryType === "identity" && identityField) {
    const field = identityField as IntakeIdentityField;
    const spec = IDENTITY_FIELD_SEARCH[field];
    return {
      ...item,
      queryType: "identity",
      label: item.label.trim() || spec.displayLabel,
      searchQuery: spec.searchQuery,
      topics:
        item.topics.length > 0
          ? [...item.topics]
          : field === "tenure"
            ? ["personal", "resume", "experience"]
            : ["personal", "resume"],
      identityField: field,
      enumerationControl: null,
    };
  }

  if (queryType === "identity" && !identityField) {
    return {
      ...item,
      queryType: "identity",
      topics:
        item.topics.length > 0 ? [...item.topics] : ["personal", "resume"],
      identityField: null,
      enumerationControl: null,
    };
  }

  if (queryType === "enumeration") {
    const listKind =
      item.enumerationControl?.listKind ??
      (item.topics.includes("project") || item.topics.includes("tech-stack")
        ? "project"
        : item.topics.includes("experience") || item.topics.includes("career")
          ? "experience"
          : null);
    if (!listKind) {
      return {
        ...item,
        queryType: "enumeration",
        identityField: null,
        enumerationControl: item.enumerationControl ?? null,
      };
    }
    const template = listKind === "project" ? PROJECTS_SLOT : EMPLOYERS_SLOT;
    const tw = item.enumerationControl?.timeWindowYears;
    return {
      ...item,
      queryType: "enumeration",
      label: item.label.trim() || template.label,
      searchQuery: template.searchQuery,
      topics: item.topics.length > 0 ? [...item.topics] : [...template.topics],
      identityField: null,
      enumerationControl: {
        action: item.enumerationControl?.action ?? "preview",
        listKind,
        excludeHint: item.enumerationControl?.excludeHint ?? null,
        timeWindowYears:
          tw != null && Number.isFinite(tw) && tw > 0 ? Math.floor(tw) : null,
      },
    };
  }

  if (queryType === "external_link") {
    return {
      ...item,
      queryType: "external_link",
      label: item.label.trim() || EXTERNAL_LINK_SLOT.label,
      searchQuery: item.searchQuery.trim() || EXTERNAL_LINK_SLOT.searchQuery,
      topics:
        item.topics.length > 0
          ? [...item.topics]
          : [...EXTERNAL_LINK_SLOT.topics],
      identityField: null,
      enumerationControl: null,
    };
  }

  return {
    ...item,
    queryType,
    identityField: item.identityField ?? null,
    enumerationControl: item.enumerationControl ?? null,
  };
};

/**
 * 修复 plan：schema 合法化 + 结构化去重。
 * 档 B：不再用 subTasks 发明槽；空 plan 保持空，由 composite 编译为单槽 default。
 */
export const repairRetrievalPlanItems = (
  plan: IntakeRetrievalPlanItem[],
  _subTasks: string[],
  _userQuestion = ""
): IntakeRetrievalPlanItem[] => {
  const items = plan.filter((p) => p.label.trim() && p.searchQuery.trim());
  return dedupePlanByFacet(items.map(normalizePlanItemFromSchema));
};
