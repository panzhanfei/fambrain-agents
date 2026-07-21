/**
 * Composite 路由解析：从 Intake decision 推出「本次要跑哪些检索槽」。
 *
 * 档 B：只信 LLM \`retrievalPlan\` → 编译为 slots。
 * 空 plan → source=none（上层 clarify，不发明模板槽）。
 */
import type {
  IntakeRetrievalPlanItem,
  IntakeRoutingDecision,
} from "@/agentflow/agents/online/intake-coordinator/contract";
import type {
  CompositeRoutePlanSource,
  ResolvedCompositeRoute,
} from "./interface";
import { planItemToSlot } from "./composite-slot-queries";

export type {
  CompositeRoutePlanSource,
  ResolvedCompositeRoute,
} from "./interface";

/** 结构信号：多问号 / 顿号并列 / 以及·还有 等（非语义词表；供 link stale 检测等） */
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

/** 按问号/分句切开用户句（结构工具；不用于发明 plan） */
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

const normalizePlanItems = (
  items: IntakeRetrievalPlanItem[]
): IntakeRetrievalPlanItem[] =>
  items.filter(
    (item) => item.label.trim().length > 0 && item.searchQuery.trim().length > 0
  );

export { normalizePlanItems };

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
 * 编排主入口：仅把 LLM retrievalPlan 编译为槽。
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
  _userQuestion: string
): ResolvedCompositeRoute => {
  if (decision.intent !== "retrieve_and_answer") {
    return { slots: [], source: "none" };
  }

  const fromIntake = normalizePlanItems(decision.retrievalPlan ?? []);
  if (fromIntake.length >= 1) {
    return {
      slots: fromIntake.map((item, i) => planItemToSlot(item, i)),
      source: "intake_retrieval_plan",
    };
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
