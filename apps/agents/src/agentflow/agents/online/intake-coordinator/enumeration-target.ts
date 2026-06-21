/**
 * enumeration 二分类：项目列举 vs 公司/任职列举。
 * 信号来源：plan 项 label/searchQuery（优先，纠正 Intake 误标 topics）→ topics → 默认 experience。
 */
import type { IntakeRetrievalPlanItem } from "./prompt";

export type EnumerationTarget = "project" | "experience";

export type EnumerationTargetInput = Pick<
    IntakeRetrievalPlanItem,
    "label" | "searchQuery" | "topics"
> & {
    subTasks?: string[];
};

const topicHas = (topics: string[], re: RegExp): boolean =>
    topics.some((t) => re.test(t));

const planSignalText = (input: EnumerationTargetInput): string =>
    [input.label, input.searchQuery, ...(input.subTasks ?? [])]
        .filter(Boolean)
        .join(" ");

/** plan label 优先于 topics，避免「具体项目名称」+ topics:experience 误路由 */
export const resolveEnumerationTarget = (
    input: EnumerationTargetInput
): EnumerationTarget => {
    const signal = planSignalText(input);
    if (/项目|project/i.test(signal) && !/公司|单位|雇主|上过班|哪几/.test(signal)) {
        return "project";
    }
    if (/公司|单位|雇主|上过班|哪几|任职/.test(signal)) {
        return "experience";
    }
    if (topicHas(input.topics, /^project|tech-stack$/)) {
        return "project";
    }
    if (topicHas(input.topics, /^experience$/)) {
        return "experience";
    }
    if (/项目/.test(signal)) {
        return "project";
    }
    return "experience";
};

export const isProjectEnumeration = (input: EnumerationTargetInput): boolean =>
    resolveEnumerationTarget(input) === "project";

export const isExperienceEnumeration = (
    input: EnumerationTargetInput
): boolean => resolveEnumerationTarget(input) === "experience";
