/**
 * Intake 编排：LLM → parse → guard 链 → RoutedIntakeDecision。
 * 每步打结构化日志，供 Web 运行日志 / 控制台复盘。
 */
import {
  applyCompositeRouteGuard,
  applyIntakeChitchatGuard,
  applyIntakeRetrievalPlanGuard,
  applyEnumerationListIntentGuard,
  type RoutedIntakeDecision,
} from "@/agentflow/brain-service/online/intake-coordinator/guards";
import {
  defaultIntakeDecision,
  parseIntakeDecision,
} from "./parse-intake";
import { applyToolPlanGuard } from "@/agentflow/tool-orchestration/enrich-plan";
import type { IntakeRoutingDecision } from "@/agentflow/brain-service/online/intake-coordinator/contract";
import { isUserFactIntent } from "@/agentflow/brain-service/online/user-fact";
import { logAgentOut } from "@fambrain/brain-shared/agent-log";
import type { DbChatTurn } from "@fambrain/brain-types";

const summarizeDecision = (
  decision: IntakeRoutingDecision | RoutedIntakeDecision
) => ({
  intent: decision.intent,
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

/** clarify / 非检索 intent 的 pipeline 早退包装（与 composite guard 的 skip_non_retrieve 一致） */
export const buildEarlyExitRoutedDecision = (
  decision: IntakeRoutingDecision
): RoutedIntakeDecision => ({
  ...decision,
  routeMode: "skip",
  compositeSlots: [],
  routeReason: "skip_non_retrieve",
  routePlanSource: "none",
});

/** LLM 判定需反问（无上下文或指代无法消解）→ pipeline 早退 */
export const isClarifyEarlyExit = (
  decision: IntakeRoutingDecision
): boolean =>
  decision.intent === "clarify" &&
  Boolean(decision.clarifyingQuestion?.trim());

/** 闲聊 / 超范围 / 短 direct_answer → respondEarly */
export const isRespondEarlyIntent = (
  decision: IntakeRoutingDecision
): boolean => {
  if (isClarifyEarlyExit(decision)) return true;
  if (
    (decision.intent === "chitchat" || decision.intent === "out_of_scope") &&
    Boolean(decision.briefReply?.trim())
  ) {
    return true;
  }
  return (
    decision.intent === "direct_answer" &&
    Boolean(decision.briefReply?.trim())
  );
};

export type RunIntakePipelineInput = {
  intakeRaw: string;
  userQuestion: string;
  intakeHistory: DbChatTurn[];
};

export type RunIntakePipelineResult = {
  decision: RoutedIntakeDecision;
  parseUsedFallback: boolean;
  /** pipeline 在检索计划/复合路由之前早退（clarify / chitchat 等） */
  earlyExit: boolean;
};

/**
 * Intake 规则主流程（LLM 之后）：parse → guard 链 → RoutedIntakeDecision。
 *
 * 步骤一览：
 *   ① 解析 LLM JSON（失败则 defaultIntakeDecision 兜底）
 *   ② clarify 早退（仅 intent=clarify 时执行）
 *   ③ chitchat guard + respondEarly（仅 intent=chitchat 时跑 guard）
 *   ④ userFact 早退（仅 remember/recall intent）
 *   ⑤ 检索计划 guard（retrieve_and_answer）
 *   ⑥ 复合路由 guard（retrieve_and_answer）
 *   ⑦ 返回最终 decision 给 compile.ts → routeAfterIntake
 */
export const runIntakePipeline = (
  input: RunIntakePipelineInput
): RunIntakePipelineResult => {
  /** ① 解析：从 intakeRaw 提取 JSON → Zod 校验为 IntakeRoutingDecision */
  const parsed = parseIntakeDecision(input.intakeRaw);
  const parseUsedFallback = parsed === null;
  /** ① 兜底 */
  let decision = parsed ?? defaultIntakeDecision(input.userQuestion);

  logAgentOut("IntakeCoordinator", "解析LLM输出", {
    parseOk: !parseUsedFallback,
    ...(parseUsedFallback
      ? {
          fallbackReason:
            "JSON 解析或 Zod 校验失败，使用 defaultIntakeDecision",
        }
      : {}),
    ...summarizeDecision(decision),
  });

  /** ② 指代/澄清：仅 clarify intent */
  if (decision.intent === "clarify") {
    const clarifyEarlyExit = isClarifyEarlyExit(decision);
    logAgentOut("IntakeCoordinator", "LLM指代决策", {
      earlyExit: clarifyEarlyExit,
      ...summarizeDecision(decision),
    });
    if (clarifyEarlyExit) {
      const routed = buildEarlyExitRoutedDecision(decision);
      logAgentOut("IntakeCoordinator", "最终路由", {
        earlyExit: true,
        reason: "clarify",
        ...summarizeDecision(routed),
      });
      return { decision: routed, parseUsedFallback, earlyExit: true };
    }
  }

  /** ③ 闲聊：仅 chitchat intent 注入 briefReply */
  if (decision.intent === "chitchat") {
    const beforeChitchat = decision;
    decision = applyIntakeChitchatGuard(decision);
    logAgentOut("IntakeCoordinator", "guard_闲聊", {
      changed: guardChanged(beforeChitchat, decision),
      ...summarizeDecision(decision),
    });
  }

  if (isRespondEarlyIntent(decision)) {
    const routed = buildEarlyExitRoutedDecision(decision);
    logAgentOut("IntakeCoordinator", "最终路由", {
      earlyExit: true,
      reason: decision.intent,
      ...summarizeDecision(routed),
    });
    return { decision: routed, parseUsedFallback, earlyExit: true };
  }

  /** ④ 用户记忆：仅 remember/recall intent */
  if (isUserFactIntent(decision.intent)) {
    logAgentOut("IntakeCoordinator", "guard_用户记忆", {
      matched: true,
      intent: decision.intent,
      userFactKey: decision.userFactKey,
      userFactLabel: decision.userFactLabel,
      hasValue: Boolean(decision.userFactValue?.trim()),
    });
    const routed = buildEarlyExitRoutedDecision(decision);
    logAgentOut("IntakeCoordinator", "最终路由", {
      earlyExit: true,
      reason: decision.intent,
      ...summarizeDecision(routed),
    });
    return { decision: routed, parseUsedFallback, earlyExit: true };
  }

  /** ⑤ 检索计划：多问并列时补全/规范化 retrievalPlan（与 检索 hits 缓存 key 对齐） */
  const afterPlan = applyIntakeRetrievalPlanGuard(
    decision,
    input.userQuestion
  );
  logAgentOut("IntakeCoordinator", "guard_检索计划", {
    reason: afterPlan.retrievalPlanGuardReason ?? "noop",
    changed: guardChanged(decision, afterPlan),
    retrievalPlanCount: afterPlan.retrievalPlan.length,
    retrievalPlanLabels: afterPlan.retrievalPlan.map((p) => p.label),
  });

  /** ⑥ 复合路由：plan → compositeSlots；定 routeMode（skip / slots / list / dag） */
  const routed = applyCompositeRouteGuard(afterPlan, input.userQuestion);
  logAgentOut("IntakeCoordinator", "guard_复合路由", {
    routeMode: routed.routeMode,
    routeReason: routed.routeReason,
    routePlanSource: routed.routePlanSource,
    compositeSlotCount: routed.compositeSlots.length,
    compositeSlots: routed.compositeSlots.map((s) => ({
      id: s.id,
      label: s.label,
      queryType: s.queryType,
      searchQuery:
        s.searchQuery.length > 120
          ? `${s.searchQuery.slice(0, 120)}…`
          : s.searchQuery,
    })),
  });

  /** ⑦ 列举分页：单问穷举 → list API */
  const withListIntent = applyEnumerationListIntentGuard(
    routed,
    input.userQuestion
  );
  if (withListIntent.listIntent === "exhaustive") {
    logAgentOut("IntakeCoordinator", "guard_列举分页", {
      listIntent: withListIntent.listIntent,
      page: withListIntent.enumerationPage,
      pageSize: withListIntent.enumerationPageSize,
      listKind: withListIntent.enumerationListKind,
    });
  }

  /** ⑧ 工具计划：dataSource / toolId / executionPlan（四类架构） */
  const withToolPlan = applyToolPlanGuard(withListIntent, input.userQuestion);
  if (
    withToolPlan.routeMode === "dag" ||
    withToolPlan.primaryDataSource === "web" ||
    (withToolPlan.enrichedPlan ?? []).some((p) => p.toolId)
  ) {
    logAgentOut("IntakeCoordinator", "guard_工具计划", {
      routeMode: withToolPlan.routeMode,
      primaryDataSource: withToolPlan.primaryDataSource,
      executionPlanCount: withToolPlan.executionPlan?.length ?? 0,
      enrichedToolIds: (withToolPlan.enrichedPlan ?? [])
        .map((p) => p.toolId)
        .filter(Boolean),
    });
  }

  /** ⑨ 出口：decision 写入 state，由 compile.ts routeAfterIntake 决定去 retrieval / dag / respondEarly 等 */
  logAgentOut("IntakeCoordinator", "最终路由", summarizeDecision(withToolPlan));
  return { decision: withToolPlan, parseUsedFallback, earlyExit: false };
};
