/**
 * 列举分页：按槽设置 executor=list_corpus，从会话补页码。
 * 不再用口语 regex 猜意图；意图来自 Intake LLM 的 enumerationControl，
 * 或 UI 按钮 prompt 的精确匹配（ENUMERATION_ACTION_PROMPTS）。
 */
import type { CompositeSessionKey } from "@fambrain/infra";
import { getEnumerationListSession } from "@fambrain/infra";
import {
    EMPLOYERS_SLOT,
    PROJECTS_SLOT,
    type CompositeRetrievalSlot,
} from "@/agentflow/agents/online/intake-coordinator/composite";
import {
    ENUMERATION_EXHAUSTIVE_PAGE_SIZE,
} from "@/agentflow/agents/online/knowledge-manager/list/list-corpus-entries";
import {
    matchUiEnumerationPrompt,
    type EnumerationControl,
    type EnumerationListKind,
} from "../enumeration-action-prompts";
import type {
    EnumerationListIntent,
    RoutedIntakeDecision,
} from "./interface";

export type { EnumerationListIntent } from "./interface";

const isListAction = (
    action: EnumerationControl["action"] | undefined
): action is "continue" | "exhaustive" =>
    action === "continue" || action === "exhaustive";

const listSlotTemplate = (
    listKind: EnumerationListKind,
    control: EnumerationControl
): CompositeRetrievalSlot => {
    const base =
        listKind === "project" ? { ...PROJECTS_SLOT } : { ...EMPLOYERS_SLOT };
    return {
        ...base,
        enumerationControl: control,
        executor: "list_corpus",
        enumerationPage: 1,
        enumerationPageSize: ENUMERATION_EXHAUSTIVE_PAGE_SIZE,
        subTasks: [base.label],
    };
};

/** 合成单槽 list 路由（UI exact-match / 脚本用）；恒为 routeMode=slots */
export const buildEnumerationListDecision = (input: {
    userQuestion: string;
    listKind: EnumerationListKind;
    listIntent: EnumerationListIntent;
    page: number;
    pageSize: number;
    excludeHint?: string | null;
}): RoutedIntakeDecision => {
    const isProject = input.listKind === "project";
    const action: EnumerationControl["action"] =
        input.listIntent === "continue" ? "continue" : "exhaustive";
    const control: EnumerationControl = {
        action,
        listKind: input.listKind,
        excludeHint: input.excludeHint ?? null,
    };
    const slot = listSlotTemplate(input.listKind, control);
    slot.enumerationPage = input.page;
    slot.enumerationPageSize = input.pageSize;
    return {
        intent: "retrieve_and_answer",
        searchQuery: slot.searchQuery,
        subTasks: [slot.label],
        topics: [...slot.topics],
        language: "zh",
        confidence: 0.95,
        queryType: "enumeration",
        clarifyingQuestion: null,
        briefReply: null,
        retrievalPlan: [
            {
                label: slot.label,
                searchQuery: slot.searchQuery,
                queryType: "enumeration",
                topics: [...slot.topics],
                enumerationControl: control,
            },
        ],
        userFactKey: null,
        userFactLabel: null,
        userFactValue: null,
        routeMode: "slots",
        compositeSlots: [slot],
        routeReason: "query_type_template",
        routePlanSource: "query_type_template",
        listIntent: input.listIntent === "preview" ? "exhaustive" : input.listIntent,
        enumerationPage: input.page,
        enumerationPageSize: input.pageSize,
        enumerationListKind: input.listKind,
    };
};

const resolvePageForControl = async (
    control: EnumerationControl,
    session: CompositeSessionKey,
    pageSize: number
): Promise<{ page: number; pageSize: number }> => {
    if (control.action === "exhaustive") {
        return { page: 1, pageSize };
    }
    if (control.action === "continue") {
        const stored = await getEnumerationListSession(session, control.listKind);
        return {
            page: (stored?.lastPage ?? 1) + 1,
            pageSize: stored?.pageSize ?? pageSize,
        };
    }
    return { page: 1, pageSize };
};

const enrichSlotExecutor = async (
    slot: CompositeRetrievalSlot,
    session: CompositeSessionKey
): Promise<CompositeRetrievalSlot> => {
    const control = slot.enumerationControl;
    if (!control || !isListAction(control.action)) {
        return {
            ...slot,
            executor: slot.executor ?? "km_retrieve",
            enumerationControl: control ?? null,
        };
    }
    const pageSize =
        slot.enumerationPageSize ?? ENUMERATION_EXHAUSTIVE_PAGE_SIZE;
    const { page, pageSize: resolvedSize } = await resolvePageForControl(
        control,
        session,
        pageSize
    );
    return {
        ...slot,
        executor: "list_corpus",
        enumerationControl: control,
        enumerationPage: page,
        enumerationPageSize: resolvedSize,
        queryType: "enumeration",
    };
};

/**
 * Guard：按槽设置 list_corpus / km_retrieve；UI 按钮精确匹配可补单槽 list。
 * 始终保持 routeMode=slots（不再升级为全局 list）。
 */
export const applyEnumerationSlotGuard = async (
    decision: RoutedIntakeDecision,
    userQuestion: string,
    session: CompositeSessionKey
): Promise<RoutedIntakeDecision> => {
    if (decision.intent !== "retrieve_and_answer") return decision;
    if (decision.routeMode !== "slots" && decision.routeMode !== "list") {
        return decision;
    }

    let slots = [...(decision.compositeSlots ?? [])];
    let retrievalPlan = [...(decision.retrievalPlan ?? [])];

    const uiControl = matchUiEnumerationPrompt(userQuestion);
    const hasListControl =
        slots.some((s) => isListAction(s.enumerationControl?.action)) ||
        retrievalPlan.some((p) =>
            isListAction(p.enumerationControl?.action)
        );

    if (uiControl && !hasListControl) {
        const listIntent: EnumerationListIntent =
            uiControl.action === "continue" ? "continue" : "exhaustive";
        const { page, pageSize } = await resolvePageForControl(
            uiControl,
            session,
            ENUMERATION_EXHAUSTIVE_PAGE_SIZE
        );
        return buildEnumerationListDecision({
            userQuestion,
            listKind: uiControl.listKind,
            listIntent,
            page,
            pageSize,
            excludeHint: uiControl.excludeHint,
        });
    }

    // 从 plan 同步 enumerationControl 到尚无 control 的槽（按 index）
    if (retrievalPlan.length > 0 && slots.length > 0) {
        slots = slots.map((slot, i) => {
            const planCtrl = retrievalPlan[i]?.enumerationControl;
            if (slot.enumerationControl || !planCtrl) return slot;
            return { ...slot, enumerationControl: planCtrl };
        });
    }

    // 单槽 enumeration：顶层未带 control 时，若 plan[0] 有则同步
    if (
        slots.length === 1 &&
        slots[0]!.queryType === "enumeration" &&
        !slots[0]!.enumerationControl &&
        retrievalPlan[0]?.enumerationControl
    ) {
        slots[0] = {
            ...slots[0]!,
            enumerationControl: retrievalPlan[0]!.enumerationControl,
        };
    }

    const enriched = await Promise.all(
        slots.map((s) => enrichSlotExecutor(s, session))
    );

    const firstList = enriched.find((s) => s.executor === "list_corpus");
    const listIntent: EnumerationListIntent | null | undefined = firstList
        ? firstList.enumerationControl?.action === "continue"
            ? "continue"
            : "exhaustive"
        : decision.listIntent ?? null;

    return {
        ...decision,
        routeMode: "slots",
        compositeSlots: enriched,
        listIntent: listIntent ?? null,
        enumerationPage: firstList?.enumerationPage ?? decision.enumerationPage,
        enumerationPageSize:
            firstList?.enumerationPageSize ?? decision.enumerationPageSize,
        enumerationListKind:
            firstList?.enumerationControl?.listKind ??
            decision.enumerationListKind,
        queryType: firstList
            ? decision.queryType === "tech" ||
              decision.queryType === "identity" ||
              decision.queryType === "external_link"
                ? decision.queryType
                : "enumeration"
            : decision.queryType,
    };
};

/**
 * @deprecated 使用 applyEnumerationSlotGuard；保留同步包装供旧测试迁移期调用。
 * 无 session 时无法解析 continue 页码，仅处理 UI exact-match exhaustive。
 */
export const applyEnumerationListIntentGuard = (
    decision: RoutedIntakeDecision,
    userQuestion: string
): RoutedIntakeDecision => {
    const ui = matchUiEnumerationPrompt(userQuestion);
    if (!ui || ui.action !== "exhaustive") {
        // 同步路径：仅标记已有 control 的槽为 list_corpus
        if (decision.routeMode !== "slots" && decision.routeMode !== "list") {
            return decision;
        }
        const slots = (decision.compositeSlots ?? []).map((slot) => {
            if (isListAction(slot.enumerationControl?.action)) {
                return {
                    ...slot,
                    executor: "list_corpus" as const,
                    enumerationPage: slot.enumerationPage ?? 1,
                    enumerationPageSize:
                        slot.enumerationPageSize ??
                        ENUMERATION_EXHAUSTIVE_PAGE_SIZE,
                };
            }
            return { ...slot, executor: slot.executor ?? ("km_retrieve" as const) };
        });
        const firstList = slots.find((s) => s.executor === "list_corpus");
        return {
            ...decision,
            routeMode: "slots",
            compositeSlots: slots,
            listIntent: firstList
                ? firstList.enumerationControl?.action === "continue"
                    ? "continue"
                    : "exhaustive"
                : decision.listIntent,
        };
    }
    return buildEnumerationListDecision({
        userQuestion,
        listKind: ui.listKind,
        listIntent: "exhaustive",
        page: 1,
        pageSize: ENUMERATION_EXHAUSTIVE_PAGE_SIZE,
    });
};

/**
 * @deprecated 入口短路已移除；UI 按钮走 LLM 或 applyEnumerationSlotGuard exact-match。
 * 保留供 verify 脚本迁移：exact-match → buildEnumerationListDecision。
 */
export const resolveEnumerationContinuation = async (input: {
    userQuestion: string;
    session: CompositeSessionKey;
}): Promise<RoutedIntakeDecision | null> => {
    const ui = matchUiEnumerationPrompt(input.userQuestion);
    if (!ui || !isListAction(ui.action)) return null;
    const listIntent: EnumerationListIntent =
        ui.action === "continue" ? "continue" : "exhaustive";
    const { page, pageSize } = await resolvePageForControl(
        ui,
        input.session,
        ENUMERATION_EXHAUSTIVE_PAGE_SIZE
    );
    return buildEnumerationListDecision({
        userQuestion: input.userQuestion,
        listKind: ui.listKind,
        listIntent,
        page,
        pageSize,
    });
};

/** @deprecated 词表已删除；仅 UI exact-match */
export const isExhaustiveListRequest = (userQuestion: string): boolean => {
    const ui = matchUiEnumerationPrompt(userQuestion);
    return ui?.action === "exhaustive";
};

/** @deprecated 词表已删除；仅 UI exact-match */
export const detectEnumerationContinuationKind = (
    userQuestion: string
): EnumerationListKind | null => {
    const ui = matchUiEnumerationPrompt(userQuestion);
    if (!ui || !isListAction(ui.action)) return null;
    return ui.listKind;
};
