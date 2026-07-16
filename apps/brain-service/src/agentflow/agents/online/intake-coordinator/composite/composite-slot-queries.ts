/**
 * 检索槽定义 + canonical 模板。
 *
 * CompositeRetrievalSlot = 一次独立 KM 调用的参数包。
 * 检索 hits 缓存 key = corpusUserId + searchQuery + queryType（按槽独立）。
 *
 * canonicalizePlanItem：把 Intake 口语 searchQuery 对齐到模板 query，
 * 避免同义问句打出不同 cache key。
 */
import type {
    IntakeRetrievalPlanItem,
    IntakeRoutingDecision,
} from "@/agentflow/agents/online/intake-coordinator/contract";
import { isProjectEnumeration } from "./enumeration-target";
import { IDENTITY_FIELD_SEARCH } from "./identity-field-search";
import type {
    CompositeFacetId,
    CompositeRetrievalSlot,
} from "./interface";

export const COMPOSITE_FACET_IDS = [
    "identity",
    "projects",
    "employers",
    "recent",
] as const satisfies readonly CompositeFacetId[];

/** canonical：个人档案 */
export const IDENTITY_SLOT: CompositeRetrievalSlot = {
    id: "identity",
    label: "姓名与档案",
    searchQuery: "个人简介 简历 姓名 年龄 职业 学历 行业",
    queryType: "identity",
    topics: ["personal", "resume"],
    subTasks: [],
};

/** canonical：项目列举 */
export const PROJECTS_SLOT: CompositeRetrievalSlot = {
    id: "projects",
    label: "项目经历",
    searchQuery: "项目经历 全部项目 所有项目 项目名称 职责 技术栈",
    queryType: "enumeration",
    topics: ["project", "tech-stack"],
    subTasks: [],
};

/** canonical：公司/任职列举 */
export const EMPLOYERS_SLOT: CompositeRetrievalSlot = {
    id: "employers",
    label: "工作经历",
    searchQuery: "哪几家公司 工作经历 公司 职位 时间",
    queryType: "enumeration",
    topics: ["experience"],
    subTasks: [],
};

/** canonical：对外链接 / 仓库 URL */
export const EXTERNAL_LINK_SLOT: CompositeRetrievalSlot = {
    id: "external_link",
    label: "对外链接",
    searchQuery: "个人简介 简历 对外链接 仓库地址 线上预览 线上地址 URL GitHub",
    queryType: "external_link",
    topics: ["personal", "resume", "project"],
    subTasks: [],
};

/** canonical：近况 */
export const RECENT_SLOT: CompositeRetrievalSlot = {
    id: "recent",
    label: "近两年",
    searchQuery: "个人简介 简历 最近 工作经历 时间线 阶段 在干什么",
    queryType: "identity",
    topics: ["personal", "resume", "experience"],
    subTasks: [],
};

/** @deprecated 综合档案不再固定 4 槽全开；保留供测试/文档引用 */
export const COMPOSITE_PROFILE_SLOTS: CompositeRetrievalSlot[] = [
    IDENTITY_SLOT,
    PROJECTS_SLOT,
    EMPLOYERS_SLOT,
    RECENT_SLOT,
];

export const getCompositeSlot = (
    id: CompositeFacetId
): CompositeRetrievalSlot => {
    const slot = COMPOSITE_PROFILE_SLOTS.find((s) => s.id === id);
    if (!slot) throw new Error(`unknown composite facet: ${id}`);
    return slot;
};

/**
 * queryType + topics → 取 canonical 模板。
 * tech / default → null（不强制模板，保留 Intake 原 query）。
 * external_link / enumeration / identity → 信 Intake queryType，不在 label 上做意图 regex。
 */
export const facetTemplateForQueryType = (
    queryType: IntakeRoutingDecision["queryType"],
    topics: string[],
    planItem?: Pick<
        IntakeRetrievalPlanItem,
        | "label"
        | "searchQuery"
        | "topics"
        | "enumerationControl"
        | "identityField"
    >
): CompositeRetrievalSlot | null => {
    if (!queryType || queryType === "tech") return null;
    if (queryType === "identity") {
        const field = planItem?.identityField ?? null;
        const fieldSpec = field ? IDENTITY_FIELD_SEARCH[field] : null;
        return {
            ...IDENTITY_SLOT,
            searchQuery: fieldSpec?.searchQuery ?? IDENTITY_SLOT.searchQuery,
            topics:
                field === "tenure"
                    ? ["personal", "resume", "experience"]
                    : [...IDENTITY_SLOT.topics],
            identityField: field,
        };
    }
    if (queryType === "external_link") {
        const label = planItem?.label?.trim() ?? "";
        return {
            ...EXTERNAL_LINK_SLOT,
            searchQuery: label
                ? `${label} ${EXTERNAL_LINK_SLOT.searchQuery}`
                : EXTERNAL_LINK_SLOT.searchQuery,
        };
    }
    if (queryType === "enumeration") {
        const targetInput = planItem ?? { label: "", searchQuery: "", topics };
        if (
            isProjectEnumeration({
                ...targetInput,
                topics: planItem?.topics ?? topics,
                listKind: planItem?.enumerationControl?.listKind ?? null,
            })
        ) {
            return { ...PROJECTS_SLOT };
        }
        return { ...EMPLOYERS_SLOT };
    }
    return null;
};

/**
 * 对齐检索 hits 缓存 key：有模板则用模板 searchQuery/topics，
 * label 仍保留用户/LLM 原 label（展示用）。
 */
export const canonicalizePlanItem = (
    item: IntakeRetrievalPlanItem
): IntakeRetrievalPlanItem => {
    const template = facetTemplateForQueryType(
        item.queryType,
        item.topics,
        item
    );
    if (!template) {
        return {
            ...item,
            enumerationControl: item.enumerationControl ?? null,
            identityField: item.identityField ?? null,
        };
    }
    return {
        ...item,
        label: item.label,
        searchQuery: template.searchQuery,
        queryType: template.queryType,
        topics: [...template.topics],
        enumerationControl: item.enumerationControl ?? null,
        identityField: item.identityField ?? template.identityField ?? null,
    };
};

/** retrievalPlan 一项 → CompositeRetrievalSlot（供并行 KM / list） */
export const planItemToSlot = (
    item: IntakeRetrievalPlanItem,
    index: number
): CompositeRetrievalSlot => {
    const canonical = canonicalizePlanItem(item);
    const template = facetTemplateForQueryType(
        canonical.queryType,
        canonical.topics,
        canonical
    );
    const control = canonical.enumerationControl ?? null;
    const needsListScan =
        control?.action === "continue" ||
        control?.action === "exhaustive" ||
        // 时间窗须目录扫盘后再过滤；preview+KM 无法保证近 N 年覆盖
        (control?.timeWindowYears != null && control.timeWindowYears > 0);
    /** 多槽时 id 必须唯一（同 template 如 projects 不可撞 slot_projects） */
    const baseId = template?.id ?? "plan";
    return {
        id: `${baseId}-${index}`,
        label: canonical.label,
        searchQuery: canonical.searchQuery,
        queryType: canonical.queryType,
        topics: [...canonical.topics],
        subTasks: [canonical.label],
        enumerationControl: control,
        identityField: canonical.identityField ?? null,
        executor: needsListScan ? "list_corpus" : "km_retrieve",
    };
};
