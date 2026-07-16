/**
 * 列举分页 UI 按钮文案（单一真相源）。
 * Intake exact-match 与 Analyst actions.prompt 共用；禁止在此维护口语 regex 词表。
 */
export type EnumerationListKind = "project" | "experience";

export type EnumerationControlAction = "preview" | "continue" | "exhaustive";

export type EnumerationControl = {
    action: EnumerationControlAction;
    listKind: EnumerationListKind;
    /** 可选：排除某实体（如「除城管外」） */
    excludeHint?: string | null;
};

/** 槽执行器：语义检索 vs 目录扫盘分页 */
export type SlotExecutor = "km_retrieve" | "list_corpus";

export const ENUMERATION_ACTION_PROMPTS = {
    project: {
        continue: "更多项目",
        exhaustive: "列出全部项目名称",
    },
    experience: {
        continue: "更多经历",
        exhaustive: "列出全部工作经历公司",
    },
} as const;

/** 仅精确匹配 UI 按钮 prompt（非自然语言词表） */
export const matchUiEnumerationPrompt = (
    userQuestion: string
): EnumerationControl | null => {
    const t = userQuestion.trim();
    if (!t) return null;
    for (const listKind of ["project", "experience"] as const) {
        const prompts = ENUMERATION_ACTION_PROMPTS[listKind];
        if (t === prompts.continue) {
            return { action: "continue", listKind };
        }
        if (t === prompts.exhaustive) {
            return { action: "exhaustive", listKind };
        }
    }
    return null;
};

export const enumerationActionPrompt = (
    listKind: EnumerationListKind,
    action: "continue" | "exhaustive"
): string => ENUMERATION_ACTION_PROMPTS[listKind][action];
