/**
 * Composite 路由解析：从 Intake decision 推出「本次要跑哪些检索槽」。
 *
 * 优先级（高 → 低）：
 * 1. retrievalPlan（LLM 给的正式计划）→ source=intake_retrieval_plan
 * 2. subTasks≥2 或问句结构多问 → 兜底拆段
 * 3. queryType 模板（identity/enumeration → 固定 canonical 槽）
 * 4. 无槽 → source=none，上层当 single
 *
 * 不依赖用户问句关键词词表；信 Intake queryType / topics / listKind / identityField。
 */
import type {
    IntakeRetrievalPlanItem,
    IntakeRoutingDecision,
} from "@/agentflow/agents/online/intake-coordinator/contract";
import type {
    CompositeRoutePlanSource,
    ResolvedCompositeRoute,
} from "./interface";
import {
    facetTemplateForQueryType,
    IDENTITY_SLOT,
    planItemToSlot,
    PROJECTS_SLOT,
    EMPLOYERS_SLOT,
} from "./composite-slot-queries";
import { resolveEnumerationTarget } from "./enumeration-target";
import { IDENTITY_FIELD_SEARCH } from "./identity-field-search";

export type {
    CompositeRoutePlanSource,
    ResolvedCompositeRoute,
} from "./interface";

/** 结构信号：多问号 / 顿号并列 / 以及·还有 等（非语义词表） */
export const looksLikeMultiPartQuestion = (question: string): boolean => {
    const q = question.trim();
    if (!q) return false;
    if (/^\d+[.．、]\s*[^\d]{2,}$/u.test(q)) return false;
    const questionMarks = (q.match(/[？?]/g) ?? []).length;
    if (questionMarks >= 2) return true;
    if (/[，,、；;]|以及|还有|另外|分别/.test(q)) return true;
    if (/\d[.．、].*\d[.．、]/s.test(q)) return true;
    return false;
};

/** 按问号/分句切开用户句（仅兜底：Intake 未给 retrievalPlan） */
export const splitQuestionUnits = (question: string): string[] => {
    const q = question.trim();
    if (!q) return [];
    const parts = q
        .split(/[？?；;]+/)
        .flatMap((chunk) => chunk.split(/[，,、]/))
        .map((s) => s.trim())
        .filter((s) => s.length >= 2);
    return [...new Set(parts)];
};

const defaultTopicsForQueryType = (
    queryType: NonNullable<IntakeRoutingDecision["queryType"]>
): string[] => {
    if (queryType === "identity") return ["personal", "resume"];
    if (queryType === "external_link") return ["personal", "resume", "project"];
    if (queryType === "enumeration") return ["experience"];
    if (queryType === "tech") return ["project", "tech-stack"];
    return [];
};

/** 把一段 label 扩成一条 retrievalPlan 项（多问兜底：勿继承顶层 enumeration） */
const buildSegmentPlanItem = (
    label: string,
    decision: Pick<
        IntakeRoutingDecision,
        "searchQuery" | "topics" | "queryType"
    >
): IntakeRetrievalPlanItem => {
    // 多问 fallback 一律 default；类型由 Intake LLM 填写，代码不再口语重标
    const searchQuery = label.trim() || decision.searchQuery.trim() || label;
    return {
        label,
        searchQuery,
        queryType: "default",
        topics: [],
    };
};

/**
 * 兜底建 plan：优先 subTasks≥2；否则结构多问切分。
 * 返回 [] 表示无法兜底拆槽。
 */
export const buildFallbackRetrievalPlan = (
    userQuestion: string,
    decision: Pick<
        IntakeRoutingDecision,
        "searchQuery" | "subTasks" | "topics" | "queryType"
    >
): IntakeRetrievalPlanItem[] => {
    if (decision.subTasks.length >= 2) {
        return decision.subTasks.map((label) =>
            buildSegmentPlanItem(label, decision)
        );
    }
    if (!looksLikeMultiPartQuestion(userQuestion)) return [];
    const units = splitQuestionUnits(userQuestion);
    if (units.length < 2) return [];
    return units.map((label) => buildSegmentPlanItem(label, decision));
};

const normalizePlanItems = (
    items: IntakeRetrievalPlanItem[]
): IntakeRetrievalPlanItem[] =>
    items.filter(
        (item) =>
            item.label.trim().length > 0 && item.searchQuery.trim().length > 0
    );

export { normalizePlanItems };

/**
 * 曾用 labels 口语词表从 subTasks 展开 identity；已废除。
 * 合并/拆分由 Intake LLM 负责；此处原样返回。
 */
export const expandIdentityPlanFromSubTasks = (
    plan: IntakeRetrievalPlanItem[],
    _subTasks: string[]
): IntakeRetrievalPlanItem[] => plan;

/** 信 Intake queryType；null/default → default（不调口语词表） */
export const resolveEffectiveQueryType = (
    _userQuestion: string,
    decision: Pick<
        IntakeRoutingDecision,
        "queryType" | "subTasks" | "searchQuery"
    >
): NonNullable<IntakeRoutingDecision["queryType"]> | "default" => {
    if (decision.queryType && decision.queryType !== "default") {
        return decision.queryType;
    }
    return "default";
};

/**
 * 单问 identity/enumeration：用结构化字段生成一条 plan（无口语正则）。
 * 主路径仍优先 retrievalPlan；此处是模板级兜底。
 */
export const buildSingleQuestionPlanItem = (
    userQuestion: string,
    decision: Pick<
        IntakeRoutingDecision,
        | "queryType"
        | "topics"
        | "subTasks"
        | "searchQuery"
        | "retrievalPlan"
    >
): IntakeRetrievalPlanItem | null => {
    const effectiveType = resolveEffectiveQueryType(userQuestion, decision);
    if (effectiveType !== "identity" && effectiveType !== "enumeration") {
        return null;
    }

    if (effectiveType === "identity") {
        const fromPlan = (decision.retrievalPlan ?? []).find(
            (p) => p.queryType === "identity" && p.identityField
        );
        const field = fromPlan?.identityField ?? null;
        if (field && IDENTITY_FIELD_SEARCH[field]) {
            const spec = IDENTITY_FIELD_SEARCH[field];
            return {
                label: fromPlan?.label || spec.displayLabel,
                searchQuery: spec.searchQuery,
                queryType: "identity",
                topics: ["personal", "resume"],
                identityField: field,
            };
        }
        return {
            label: "个人档案",
            searchQuery: IDENTITY_SLOT.searchQuery,
            queryType: "identity",
            topics: ["personal", "resume"],
            identityField: null,
        };
    }

    const listKind =
        (decision.retrievalPlan ?? []).find(
            (p) => p.queryType === "enumeration"
        )?.enumerationControl?.listKind ?? null;
    const target = resolveEnumerationTarget({
        label: userQuestion,
        searchQuery: decision.searchQuery,
        topics: decision.topics,
        listKind,
    });
    if (target === "project") {
        return {
            label: "项目经历",
            searchQuery: PROJECTS_SLOT.searchQuery,
            queryType: "enumeration",
            topics: ["project"],
            enumerationControl: {
                action: "preview",
                listKind: "project",
                excludeHint: null,
            },
        };
    }
    return {
        label: "工作经历",
        searchQuery: EMPLOYERS_SLOT.searchQuery,
        queryType: "enumeration",
        topics: ["experience"],
        enumerationControl: {
            action: "preview",
            listKind: "experience",
            excludeHint: null,
        },
    };
};

/**
 * 编排主入口：解析本次应跑哪些检索槽（动态子集，非固定 4 槽全开）。
 * 被 applyCompositeRouteGuard 调用。
 */
export const resolveCompositeRoute = (
    decision: Pick<
        IntakeRoutingDecision,
        | "intent"
        | "searchQuery"
        | "subTasks"
        | "topics"
        | "queryType"
        | "retrievalPlan"
    >,
    userQuestion: string
): ResolvedCompositeRoute => {
    if (decision.intent !== "retrieve_and_answer") {
        return { slots: [], source: "none" };
    }

    // ① 优先信 Intake 正式 plan
    const fromIntake = normalizePlanItems(decision.retrievalPlan ?? []);
    if (fromIntake.length >= 1) {
        return {
            slots: fromIntake.map((item, i) => planItemToSlot(item, i)),
            source: "intake_retrieval_plan",
        };
    }

    // ② subTasks 或多问句式兜底
    const fromSubTasks = buildFallbackRetrievalPlan(userQuestion, decision);
    if (fromSubTasks.length >= 2) {
        return {
            slots: fromSubTasks.map((item, i) => planItemToSlot(item, i)),
            source:
                decision.subTasks.length >= 2
                    ? "intake_subtasks"
                    : "structural_multipart",
        };
    }

    // ③ queryType → canonical 模板（如 identity → IDENTITY_SLOT）
    const template = facetTemplateForQueryType(
        decision.queryType,
        decision.topics,
        {
            label: userQuestion,
            searchQuery: decision.searchQuery,
            topics: decision.topics,
        }
    );
    if (template) {
        return { slots: [template], source: "query_type_template" };
    }

    const effectiveType = resolveEffectiveQueryType(userQuestion, decision);
    const enumTopics =
        effectiveType === "enumeration"
            ? resolveEnumerationTarget({
                  label: userQuestion,
                  searchQuery: decision.searchQuery,
                  topics: decision.topics,
              }) === "project"
                ? ["project"]
                : decision.topics.length > 0
                  ? decision.topics
                  : ["experience"]
            : decision.topics;
    const inferredTemplate = facetTemplateForQueryType(
        effectiveType === "default" ? null : effectiveType,
        enumTopics,
        {
            label: userQuestion,
            searchQuery: decision.searchQuery,
            topics: enumTopics,
        }
    );
    if (inferredTemplate) {
        return { slots: [inferredTemplate], source: "query_type_template" };
    }

    return { slots: [], source: "none" };
};

/** 是否会走 ≥2 槽 composite（诊断用） */
export const isCompositeProfileQuestion = (
    decision: Pick<
        IntakeRoutingDecision,
        | "intent"
        | "searchQuery"
        | "subTasks"
        | "topics"
        | "queryType"
        | "retrievalPlan"
    >,
    userQuestion: string
): boolean => resolveCompositeRoute(decision, userQuestion).slots.length >= 2;

/**
 * tech 单问：仅信 Intake queryType（诊断/脚本用）。
 */
export const isTechSingleQuestion = (
    _userQuestion: string,
    decision: Pick<IntakeRoutingDecision, "queryType" | "searchQuery">
): boolean => decision.queryType === "tech";
