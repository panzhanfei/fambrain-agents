/**
 * Intake 编排：LLM → parse → guard 链 → RoutedIntakeDecision。
 * 每步打结构化日志，供 Web 运行日志 / 控制台复盘。
 */
import { logAgentOut } from "@fambrain/agent-shared/agent-log";
import type { DbChatTurn } from "@fambrain/agent-types";
import {
  defaultIntakeDecision,
  parseIntakeDecision,
} from "@/agentflow/agents/online/intake-coordinator/parse-intake";
import { applyCompositeRouteGuard } from "../composite/composite-route-guard";
import type { RoutedIntakeDecision } from "../composite/composite-route-guard";
import { applyIntakeChitchatGuard } from "../guards/intake-chitchat-guard";
import { applyIntakeCoreferenceGuard } from "../guards/intake-coreference-guard";
import { applyIntakeRetrievalPlanGuard } from "../guards/intake-retrieval-plan-guard";
import { applyUserFactFromIntake } from "../guards/intake-user-fact-guard";
import type { IntakeRoutingDecision } from "../contract/prompt";
import { routeUserFactFromIntake } from "../user-fact/user-fact";

const summarizeDecision = (
  decision: IntakeRoutingDecision | RoutedIntakeDecision
) => ({
  intent: decision.intent,
  needsRetrieval: decision.needsRetrieval,
  searchQuery: decision.searchQuery,
  queryType: decision.queryType,
  subTasks: decision.subTasks,
  topics: decision.topics,
  confidence: decision.confidence,
  clarifyingQuestion: decision.clarifyingQuestion,
  briefReply: decision.briefReply,
  retrievalPlanCount: decision.retrievalPlan?.length ?? 0,
  retrievalPlanLabels: (decision.retrievalPlan ?? []).map((p) => p.label),
  userFactKey: decision.userFactKey,
  userFactLabel: decision.userFactLabel,
  ...("routeMode" in decision
    ? {
        routeMode: decision.routeMode,
        compositeSlotCount: decision.compositeSlots?.length ?? 0,
        compositeSlotLabels: (decision.compositeSlots ?? []).map(
          (s) => s.label
        ),
        routeReason: decision.routeReason,
        routePlanSource: decision.routePlanSource,
        userFactAction: decision.userFact?.action ?? null,
      }
    : {}),
});

const guardChanged = (
  before: IntakeRoutingDecision,
  after: IntakeRoutingDecision
): boolean =>
  JSON.stringify(summarizeDecision(before)) !==
  JSON.stringify(summarizeDecision(after));

export type RunIntakePipelineInput = {
  intakeRaw: string;
  userQuestion: string;
  intakeHistory: DbChatTurn[];
};

export type RunIntakePipelineResult = {
  decision: RoutedIntakeDecision;
  parseUsedFallback: boolean;
};

/**
 * Intake 规则主流程（LLM 之后）：parse → guard 链 → RoutedIntakeDecision。
 *
 * 步骤一览：
 *   ① 解析 LLM JSON（失败则 defaultIntakeDecision 兜底）
 *   ② 指代 guard（无上下文「那个项目呢」→ clarify）
 *   ③ 闲聊 guard（briefReply 模板化）
 *   ④ 用户记忆分流（remember/recall → 短路，跳过 ⑤⑥）
 *   ⑤ 检索计划 guard（多问补 retrievalPlan、canonicalize）
 *   ⑥ 复合路由 guard（plan → routeMode + compositeSlots）
 *   ⑦ 返回最终 decision 给 compile.ts → routeAfterIntake
 */
export const runIntakePipeline = (
  input: RunIntakePipelineInput
): RunIntakePipelineResult => {
  /** ① 解析：从 intakeRaw 提取 JSON → Zod 校验为 IntakeRoutingDecision */
  const parsed = parseIntakeDecision(input.intakeRaw);
  const parseUsedFallback = parsed === null;
  /** ① 兜底：LLM 非 JSON 或字段不合法时，用 userQuestion 构造「尽量检索」的默认工单 */
  const base = parsed ?? defaultIntakeDecision(input.userQuestion);

  logAgentOut("IntakeCoordinator", "解析LLM输出", {
    parseOk: !parseUsedFallback,
    ...(parseUsedFallback
      ? {
          fallbackReason:
            "JSON 解析或 Zod 校验失败，使用 defaultIntakeDecision",
        }
      : {}),
    ...summarizeDecision(base),
  });

  /** ② 指代：模糊指代且无 history 实体 → clarify；有上文 → 补全 searchQuery */
  const afterCoreference = applyIntakeCoreferenceGuard(
    base,
    input.intakeHistory
  );
  logAgentOut("IntakeCoordinator", "guard_指代", {
    changed: guardChanged(base, afterCoreference),
    ...summarizeDecision(afterCoreference),
  });

  /** ③ 闲聊：chitchat 的 briefReply 不合格（幻觉称呼）→ 替换为 FamBrain 标准话术 */
  const afterChitchat = applyIntakeChitchatGuard(afterCoreference);
  logAgentOut("IntakeCoordinator", "guard_闲聊", {
    changed: guardChanged(afterCoreference, afterChitchat),
    ...summarizeDecision(afterChitchat),
  });

  /** ④ 用户记忆：intent 为 remember_user_fact / recall_user_fact → 解析 userFactRoute */
  const userFactRoute = routeUserFactFromIntake(afterChitchat);
  logAgentOut("IntakeCoordinator", "guard_用户记忆", {
    matched: Boolean(userFactRoute),
    ...(userFactRoute
      ? {
          action: userFactRoute.action,
          factKey: userFactRoute.factKey,
          label: userFactRoute.label,
          hasValue: Boolean(userFactRoute.value),
        }
      : {}),
  });

  /** ④ 短路：命中 userFact 则包装 RoutedIntakeDecision 并 return，不进入 KM/composite */
  if (userFactRoute) {
    const decision = applyUserFactFromIntake(afterChitchat, userFactRoute);
    logAgentOut("IntakeCoordinator", "最终路由", summarizeDecision(decision));
    return { decision, parseUsedFallback };
  }

  /** ⑤ 检索计划：多问并列时补全/规范化 retrievalPlan（与 L2 cache key 对齐） */
  const afterPlan = applyIntakeRetrievalPlanGuard(
    afterChitchat,
    input.userQuestion
  );
  logAgentOut("IntakeCoordinator", "guard_检索计划", {
    reason: afterPlan.retrievalPlanGuardReason ?? "noop",
    changed: guardChanged(afterChitchat, afterPlan),
    retrievalPlanCount: afterPlan.retrievalPlan.length,
    retrievalPlanLabels: afterPlan.retrievalPlan.map((p) => p.label),
  });

  /** ⑥ 复合路由：plan → compositeSlots；定 routeMode（single / slot / composite） */
  const decision = applyCompositeRouteGuard(afterPlan, input.userQuestion);
  logAgentOut("IntakeCoordinator", "guard_复合路由", {
    routeMode: decision.routeMode,
    routeReason: decision.routeReason,
    routePlanSource: decision.routePlanSource,
    compositeSlotCount: decision.compositeSlots.length,
    compositeSlots: decision.compositeSlots.map((s) => ({
      id: s.id,
      label: s.label,
      queryType: s.queryType,
      searchQuery:
        s.searchQuery.length > 120
          ? `${s.searchQuery.slice(0, 120)}…`
          : s.searchQuery,
    })),
  });

  /** ⑦ 出口：decision 写入 state，由 compile.ts routeAfterIntake 决定去 retrieval / respondEarly 等 */
  logAgentOut("IntakeCoordinator", "最终路由", summarizeDecision(decision));
  return { decision, parseUsedFallback };
};
