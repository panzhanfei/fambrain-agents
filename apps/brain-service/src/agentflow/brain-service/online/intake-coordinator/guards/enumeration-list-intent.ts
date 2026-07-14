/**
 * 列举分页意图：用户「更多项目 / 列出全部」等续问检测。
 */
import type { CompositeSessionKey } from "@fambrain/infra";
import { getEnumerationListSession } from "@fambrain/infra";
import { resolveEnumerationTarget } from "@/agentflow/brain-service/online/intake-coordinator/composite";
import {
    ENUMERATION_EXHAUSTIVE_PAGE_SIZE,
} from "@/agentflow/brain-service/online/knowledge-manager/list/list-corpus-entries";
import type {
    EnumerationListIntent,
    RoutedIntakeDecision,
} from "./interface";

export type { EnumerationListIntent } from "./interface";

const MORE_PROJECT_RE =
    /更多项目|查看更多项目|下一页项目|还有项目|继续列出项目|其余项目/;
const MORE_EXPERIENCE_RE =
    /更多经历|查看更多经历|下一页经历|还有.*公司|继续列出.*公司|其余.*公司|更多公司/;
const EXHAUSTIVE_RE =
    /列出全部|都列|所有.*项目|全部.*项目|完整列表|穷举|列出.*36|36\s*个.*项目|全部项目名称|所有项目名称|全部工作经历|所有公司/;

export const isExhaustiveListRequest = (userQuestion: string): boolean =>
    EXHAUSTIVE_RE.test(userQuestion.trim());

export const detectEnumerationContinuationKind = (
    userQuestion: string
): "project" | "experience" | null => {
    const q = userQuestion.trim();
    if (!q) return null;
    if (MORE_PROJECT_RE.test(q) || /全部项目|所有项目|项目名称/.test(q)) {
        return "project";
    }
    if (
        MORE_EXPERIENCE_RE.test(q) ||
        /全部经历|所有公司|哪几家公司|上过班/.test(q)
    ) {
        return "experience";
    }
    if (isExhaustiveListRequest(q)) {
        return resolveEnumerationTarget({
            label: q,
            searchQuery: q,
            topics: /项目|project/i.test(q) ? ["project"] : ["experience"],
        }) === "project"
            ? "project"
            : "experience";
    }
    return null;
};

export const buildEnumerationListDecision = (input: {
    userQuestion: string;
    listKind: "project" | "experience";
    listIntent: EnumerationListIntent;
    page: number;
    pageSize: number;
}): RoutedIntakeDecision => {
    const isProject = input.listKind === "project";
    return {
        intent: "retrieve_and_answer",
        searchQuery: isProject
            ? "项目经历 全部项目 项目名称 职责"
            : "工作经历 全部公司 任职 雇主",
        subTasks: [isProject ? "项目经历" : "工作经历"],
        topics: isProject ? ["project"] : ["experience"],
        language: "zh",
        confidence: 0.95,
        queryType: "enumeration",
        clarifyingQuestion: null,
        briefReply: null,
        retrievalPlan: [],
        userFactKey: null,
        userFactLabel: null,
        userFactValue: null,
        routeMode: "list",
        compositeSlots: [],
        routeReason: "slots_default",
        routePlanSource: "none",
        listIntent: input.listIntent,
        enumerationPage: input.page,
        enumerationPageSize: input.pageSize,
        enumerationListKind: input.listKind,
    };
};

/** 续问 / 穷举：跳过 Intake LLM，直接合成路由 */
export const resolveEnumerationContinuation = async (input: {
    userQuestion: string;
    session: CompositeSessionKey;
}): Promise<RoutedIntakeDecision | null> => {
    const listKind = detectEnumerationContinuationKind(input.userQuestion);
    if (!listKind) return null;

    if (isExhaustiveListRequest(input.userQuestion)) {
        return buildEnumerationListDecision({
            userQuestion: input.userQuestion,
            listKind,
            listIntent: "exhaustive",
            page: 1,
            pageSize: ENUMERATION_EXHAUSTIVE_PAGE_SIZE,
        });
    }

    if (
        !MORE_PROJECT_RE.test(input.userQuestion) &&
        !MORE_EXPERIENCE_RE.test(input.userQuestion)
    ) {
        return null;
    }

    const session = await getEnumerationListSession(input.session, listKind);
    const pageSize =
        session?.pageSize ?? ENUMERATION_EXHAUSTIVE_PAGE_SIZE;
    const nextPage = (session?.lastPage ?? 1) + 1;

    return buildEnumerationListDecision({
        userQuestion: input.userQuestion,
        listKind,
        listIntent: "continue",
        page: nextPage,
        pageSize,
    });
};

/** slots + enumeration + 穷举关键词 → 升级为 list 分页（跳过 hybrid Top-K） */
export const applyEnumerationListIntentGuard = (
    decision: RoutedIntakeDecision,
    userQuestion: string
): RoutedIntakeDecision => {
    if (decision.routeMode === "list") return decision;
    if (decision.routeMode !== "slots") return decision;
    if (decision.queryType !== "enumeration") return decision;
    if (
        decision.listIntent === "continue" ||
        decision.listIntent === "exhaustive"
    ) {
        return { ...decision, routeMode: "list" };
    }
    if (!isExhaustiveListRequest(userQuestion)) return decision;

    const listKind =
        decision.enumerationListKind ??
        resolveEnumerationTarget({
            label: userQuestion,
            searchQuery: decision.searchQuery,
            topics: decision.topics,
            subTasks: decision.subTasks,
        });

    return {
        ...decision,
        routeMode: "list",
        listIntent: "exhaustive",
        enumerationPage: 1,
        enumerationPageSize: ENUMERATION_EXHAUSTIVE_PAGE_SIZE,
        enumerationListKind: listKind,
    };
};
