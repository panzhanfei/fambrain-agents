/**
 * enumeration 二分类：项目列举 vs 公司/任职列举。
 *
 * 信号优先级（结构化，无口语词表）：
 *   enumerationControl.listKind
 *   → topics（project / tech-stack / experience）
 *   → 默认 experience
 */
import type {
    EnumerationTarget,
    EnumerationTargetInput,
} from "./interface";

export type { EnumerationTarget, EnumerationTargetInput } from "./interface";

/**
 * 判定列举目标。
 * 例：topics 含 project → project；listKind=experience → experience。
 */
export const resolveEnumerationTarget = (
    input: EnumerationTargetInput
): EnumerationTarget => {
    if (input.listKind === "project" || input.listKind === "experience") {
        return input.listKind;
    }
    const topics = input.topics ?? [];
    if (
        topics.includes("project") ||
        topics.includes("tech-stack")
    ) {
        return "project";
    }
    if (topics.includes("experience")) {
        return "experience";
    }
    return "experience";
};

export const isProjectEnumeration = (input: EnumerationTargetInput): boolean =>
    resolveEnumerationTarget(input) === "project";
