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
} from "@/agentflow/agents/online/corpus-lister/list";
import {
    matchUiEnumerationPrompt,
    type EnumerationControl,
    type EnumerationListKind,
} from "../enumeration";
import { compilePathPlan } from "@/agentflow/agents/online/intake-coordinator/path-plan";
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
    const partial: RoutedIntakeDecision = {
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
        pathPlan: { km: [], list: [], tool: [], dag: [] },
        composeMode: "qa",
        routeReason: "query_type_template",
        routePlanSource: "query_type_template",
        listIntent: input.listIntent === "preview" ? "exhaustive" : input.listIntent,
        enumerationPage: input.page,
        enumerationPageSize: input.pageSize,
        enumerationListKind: input.listKind,
    };
    const { pathPlan, composeMode } = compilePathPlan(
        partial,
        input.userQuestion
    );
    return { ...partial, pathPlan, composeMode };
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
    if (slot.queryType !== "enumeration") {
        return {
            ...slot,
            executor: "km_retrieve",
            enumerationControl: null,
        };
    }

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
 * Intake guard ⑦：列举分页 / per-slot executor。
 *
 * 本步新增/改写：
 *   Δ compositeSlots[].executor = list_corpus | km_retrieve
 *   + listIntent / enumerationPage / enumerationPageSize / enumerationListKind
 *   UI 按钮 exact-match 可补单槽 list（ENUMERATION_ACTION_PROMPTS）
 *
 * preview 列举仍 km_retrieve；continue/exhaustive → list_corpus（目录扫盘）。
 * routeMode 保持 slots（不再整轮升为 list）。
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

    // 从 plan 同步 enumerationControl → 仅 enumeration 槽，按 label 对齐（非 index）
    if (retrievalPlan.length > 0 && slots.length > 0) {
        slots = slots.map((slot) => {
            if (slot.queryType !== "enumeration" || slot.enumerationControl) {
                return slot;
            }
            const planItem = retrievalPlan.find((p) => p.label === slot.label);
            const planCtrl = planItem?.enumerationControl;
            if (!planCtrl || planItem?.queryType !== "enumeration") return slot;
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
