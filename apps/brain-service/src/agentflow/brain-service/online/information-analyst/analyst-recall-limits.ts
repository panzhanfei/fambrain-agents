import {
    getProfileRecallParams,
    PROFILE_MAX_HITS,
} from "@/agentflow/brain-service/online/knowledge-manager";
import {
    resolveQueryProfile,
    type QueryProfile,
} from "@/agentflow/brain-service/online/knowledge-manager";

/** Analyst 子问 / 单问可见 hits 上限（与 KM profile 对齐，非固定 4）。 */
export const maxAnalystHitsForProfile = (profile: QueryProfile): number =>
    getProfileRecallParams(profile).maxHits;

export const resolveAnalystQueryProfile = (input: {
    userQuestion: string;
    subTasks?: string[];
    queryType?: QueryProfile | null;
    searchQuery?: string;
}): QueryProfile =>
    resolveQueryProfile(
        input.searchQuery?.trim() || input.userQuestion,
        input.subTasks ?? [],
        input.queryType ?? undefined
    );

/** 单问非 tech 走纯文本流式，避免 JSON + think 解析失败退回 excerpt 体。 */
export const prefersPlainTextAnalystStream = (profile: QueryProfile): boolean =>
    profile === "enumeration" ||
    profile === "identity" ||
    profile === "external_link" ||
    profile === "default";

/** @deprecated 测试兼容；新代码用 maxAnalystHitsForProfile */
export const MAX_SUB_QUESTION_HITS = PROFILE_MAX_HITS.default;
