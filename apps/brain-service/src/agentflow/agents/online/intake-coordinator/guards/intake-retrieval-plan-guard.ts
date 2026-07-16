/**
 * Intake 入口兜底：多问时补全 / 规范化 retrievalPlan，与 检索 hits 缓存 对齐。
 * 串联在 chitchat guard / clarify 早退 之后、composite route guard 之前。
 */
import {
    buildFallbackRetrievalPlan,
    expandIdentityPlanFromSubTasks,
    looksLikeMultiPartQuestion,
    normalizePlanItems,
    canonicalizePlanItem,
    repairRetrievalPlanItems,
} from "@/agentflow/agents/online/intake-coordinator/composite";
import type { IntakeRoutingDecision } from "@/agentflow/agents/online/intake-coordinator/contract";
import type { IntakeRetrievalPlanGuardReason } from "./interface";

export type { IntakeRetrievalPlanGuardReason } from "./interface";

/**
 * 1. 多问但 Intake 未给足 retrievalPlan → 结构/subTasks 兜底补 plan
 * 2. 过粗 default/enumeration / 合并子问 → repair 按目录重标
 * 3. 各 plan 项 searchQuery 对齐 canonical 模板 → 检索 hits 缓存 可复用
 */
export const applyIntakeRetrievalPlanGuard = (
    decision: IntakeRoutingDecision,
    userQuestion: string
): IntakeRoutingDecision & {
    retrievalPlanGuardReason?: IntakeRetrievalPlanGuardReason;
} => {
    if (decision.intent !== "retrieve_and_answer") {
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

    if (multipart && plan.length >= 1) {
        const expanded = expandIdentityPlanFromSubTasks(plan, decision.subTasks);
        if (expanded.length > plan.length) {
            plan = expanded;
            reason = reason === "noop" ? "expanded_identity" : reason;
        }
    }

    if (multipart && plan.length >= 1) {
        const repaired = repairRetrievalPlanItems(
            plan,
            decision.subTasks,
            userQuestion
        );
        if (
            repaired.length !== plan.length ||
            repaired.some(
                (item, i) =>
                    item.queryType !== plan[i]?.queryType ||
                    item.identityField !== plan[i]?.identityField
            )
        ) {
            plan = repaired;
            reason = reason === "noop" ? "repaired_plan" : reason;
        } else {
            plan = repaired;
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
