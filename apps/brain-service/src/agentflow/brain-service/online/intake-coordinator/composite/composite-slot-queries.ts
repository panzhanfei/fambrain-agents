/**
 * Composite 检索槽：canonical 模板 + Intake retrievalPlan 动态项。
 * L2 cache key = corpusUserId + searchQuery + queryType（按槽独立）。
 */
import type { IntakeRetrievalPlanItem } from "../contract/prompt";
import type { IntakeRoutingDecision } from "../contract/prompt";
import {
    isProjectEnumeration,
    resolveEnumerationTarget,
} from "./enumeration-target";

export const COMPOSITE_FACET_IDS = [
    "identity",
    "projects",
    "employers",
    "recent",
] as const;

export type CompositeFacetId = (typeof COMPOSITE_FACET_IDS)[number];

/** 槽 id：已知 facet 或 plan-N 动态项 */
export type CompositeSlotId = CompositeFacetId | `plan-${number}` | string;

export type CompositeRetrievalSlot = {
    id: CompositeSlotId;
    label: string;
    searchQuery: string;
    queryType: NonNullable<IntakeRoutingDecision["queryType"]>;
    topics: string[];
    subTasks: string[];
};

export const IDENTITY_SLOT: CompositeRetrievalSlot = {
    id: "identity",
    label: "姓名与档案",
    searchQuery: "个人简介 简历 姓名 年龄 职业 学历 行业",
    queryType: "identity",
    topics: ["personal", "resume"],
    subTasks: [],
};

export const PROJECTS_SLOT: CompositeRetrievalSlot = {
    id: "projects",
    label: "项目经历",
    searchQuery: "项目经历 全部项目 项目名称 职责 技术栈",
    queryType: "enumeration",
    topics: ["project", "tech-stack"],
    subTasks: [],
};

export const EMPLOYERS_SLOT: CompositeRetrievalSlot = {
    id: "employers",
    label: "工作经历",
    searchQuery: "哪几家公司 工作经历 公司 职位 时间",
    queryType: "enumeration",
    topics: ["experience"],
    subTasks: [],
};

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

const topicHas = (topics: string[], re: RegExp): boolean =>
    topics.some((t) => re.test(t));

/** queryType + topics/label 映射 canonical 模板 */
export const facetTemplateForQueryType = (
    queryType: IntakeRoutingDecision["queryType"],
    topics: string[],
    planItem?: Pick<
        IntakeRetrievalPlanItem,
        "label" | "searchQuery" | "topics"
    >
): CompositeRetrievalSlot | null => {
    if (!queryType || queryType === "tech") return null;
    if (queryType === "identity") return { ...IDENTITY_SLOT };
    if (queryType === "enumeration") {
        const targetInput = planItem ?? { label: "", searchQuery: "", topics };
        if (
            isProjectEnumeration({
                ...targetInput,
                topics: planItem?.topics ?? topics,
            })
        ) {
            return { ...PROJECTS_SLOT };
        }
        return { ...EMPLOYERS_SLOT };
    }
    return null;
};

/** 将 plan 项 searchQuery 对齐 canonical 模板，稳定 L2 cache key */
export const canonicalizePlanItem = (
    item: IntakeRetrievalPlanItem
): IntakeRetrievalPlanItem => {
    const template = facetTemplateForQueryType(
        item.queryType,
        item.topics,
        item
    );
    if (!template) return item;
    return {
        ...item,
        label: item.label,
        searchQuery: template.searchQuery,
        queryType: template.queryType,
        topics: [...template.topics],
    };
};

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
    return {
        id: template?.id ?? `plan-${index}`,
        label: canonical.label,
        searchQuery: canonical.searchQuery,
        queryType: canonical.queryType,
        topics: [...canonical.topics],
        subTasks: [canonical.label],
    };
};
