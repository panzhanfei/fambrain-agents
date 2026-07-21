/**
 * Intake guard ⑤：retrievalPlan schema 合法化 + 结构化去重 + canonicalize（编译对齐缓存）。
 *
 * 档 B：不再用 subTasks / 问句结构发明多槽（禁止 filled_fallback / expand）。
 * 语义终稿由 Intake LLM 负责；本步只纠偏非法字段与对齐模板 searchQuery。
 */
import {
  normalizePlanItems,
  canonicalizePlanItem,
  repairRetrievalPlanItems,
} from "@/agentflow/agents/online/intake-coordinator/composite";
import type { IntakeRoutingDecision } from "@/agentflow/agents/online/intake-coordinator/contract";
import type { IntakeRetrievalPlanGuardReason } from "./interface";

export type { IntakeRetrievalPlanGuardReason } from "./interface";

/**
 * 1. Zod 已过的 plan → normalize（去空项）
 * 2. schema 合法化 + 按 facet 去重（不发明新槽）
 * 3. canonicalize searchQuery（identityField / listKind → 模板，供缓存）
 */
export const applyIntakeRetrievalPlanGuard = (
  decision: IntakeRoutingDecision,
  _userQuestion: string
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

  let plan = normalizePlanItems(decision.retrievalPlan ?? []);
  let reason: IntakeRetrievalPlanGuardReason = "noop";

  const repaired = repairRetrievalPlanItems(plan, decision.subTasks);
  if (
    repaired.length !== plan.length ||
    repaired.some(
      (item, i) =>
        item.queryType !== plan[i]?.queryType ||
        item.identityField !== plan[i]?.identityField
    )
  ) {
    reason = "repaired_plan";
  }
  plan = repaired;

  const canonicalized = plan.map(canonicalizePlanItem);
  if (
    reason === "noop" &&
    canonicalized.some((item, i) => item.searchQuery !== plan[i]?.searchQuery)
  ) {
    reason = "canonicalized";
  }
  plan = canonicalized;

  return {
    ...decision,
    retrievalPlan: plan,
    subTasks: plan.length >= 2 ? plan.map((p) => p.label) : decision.subTasks,
    retrievalPlanGuardReason: reason,
  };
};
