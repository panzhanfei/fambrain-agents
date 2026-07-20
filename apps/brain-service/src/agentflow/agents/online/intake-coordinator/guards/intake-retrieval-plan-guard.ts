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
    /** 步骤 1：非 retrieve 意图 → 不补 plan */
    if (decision.intent !== "retrieve_and_answer") {
        return {
            ...decision,
            retrievalPlan: decision.retrievalPlan ?? [],
            retrievalPlanGuardReason: "noop",
        };
    }

    /**
     * 步骤 2：是否「多问」— 问句结构像并列/编号，或 LLM subTasks ≥ 2。
     */
    const multipart =
        looksLikeMultiPartQuestion(userQuestion) ||
        decision.subTasks.length >= 2;

    /** 步骤 3：Zod 合法化 plan 各项（非法 queryType 等） */
    let plan = normalizePlanItems(decision.retrievalPlan ?? []);
    let reason: IntakeRetrievalPlanGuardReason = "noop";

    /**
     * 步骤 4：多问但 plan 不足 2 条 → 用问句结构/subTasks 兜底生成 plan。
     */
    if (multipart && plan.length < 2) {
        const fallback = buildFallbackRetrievalPlan(userQuestion, decision);
        if (fallback.length >= 2) {
            plan = fallback;
            reason = "filled_fallback";
        }
    }

    /**
     * 步骤 5：subTasks 里有 identity 子问但 plan 缺项 → 按 identityField 扩槽。
     */
    if (multipart && plan.length >= 1) {
        const expanded = expandIdentityPlanFromSubTasks(plan, decision.subTasks);
        if (expanded.length > plan.length) {
            plan = expanded;
            reason = reason === "noop" ? "expanded_identity" : reason;
        }
    }

    /**
     * 步骤 6：repair — 合并重复、按 identityField/listKind 重标 queryType，去脏项。
     */
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

    /**
     * 步骤 7：canonicalize — 各 plan 项 searchQuery 对齐模板，便于检索 hits 缓存命中。
     */
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

    /** 步骤 8：多问且 plan≥2 时，subTasks 与 plan label 对齐 */
    return {
        ...decision,
        retrievalPlan: plan,
        subTasks:
            plan.length >= 2 ? plan.map((p) => p.label) : decision.subTasks,
        retrievalPlanGuardReason: reason,
    };
};
