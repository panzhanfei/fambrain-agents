/**
 * Intake 入口兜底：多问时补全 / 规范化 retrievalPlan，与 L2 检索 cache 对齐。
 * 串联在 coreference / chitchat guard 之后、composite route guard 之前。
 */
import {
    buildFallbackRetrievalPlan,
    looksLikeMultiPartQuestion,
    normalizePlanItems,
} from "./composite-routing";
import { canonicalizePlanItem } from "./composite-slot-queries";
import type { IntakeRoutingDecision } from "./prompt";

export type IntakeRetrievalPlanGuardReason =
    | "noop"
    | "filled_fallback"
    | "canonicalized";

/**
 * 1. 多问但 Intake 未给足 retrievalPlan → 结构/subTasks 兜底补 plan
 * 2. 各 plan 项 searchQuery 对齐 canonical 模板 → L2 cache 可复用
 */
export const applyIntakeRetrievalPlanGuard = (
    decision: IntakeRoutingDecision,
    userQuestion: string
): IntakeRoutingDecision & { retrievalPlanGuardReason?: IntakeRetrievalPlanGuardReason } => {
    if (
        decision.intent !== "retrieve_and_answer" ||
        !decision.needsRetrieval
    ) {
        return {
            ...decision,
            retrievalPlan: decision.retrievalPlan ?? [],
            retrievalPlanGuardReason: "noop",
        };
    }

    const multipart =
        looksLikeMultiPartQuestion(userQuestion) ||
        decision.subTasks.length >= 2;

    let plan = normalizePlanItems(decision.retrievalPlan ?? []);
    let reason: IntakeRetrievalPlanGuardReason = "noop";

    if (multipart && plan.length < 2) {
        const fallback = buildFallbackRetrievalPlan(userQuestion, decision);
        if (fallback.length >= 2) {
            plan = fallback;
            reason = "filled_fallback";
        }
    }

    const canonicalized = plan.map(canonicalizePlanItem);
    if (
        reason === "noop" &&
        canonicalized.some(
            (item, i) => item.searchQuery !== plan[i]?.searchQuery
        )
    ) {
        reason = "canonicalized";
    }
    plan = canonicalized;

    return {
        ...decision,
        retrievalPlan: plan,
        subTasks:
            plan.length >= 2 ? plan.map((p) => p.label) : decision.subTasks,
        retrievalPlanGuardReason: reason,
    };
};
