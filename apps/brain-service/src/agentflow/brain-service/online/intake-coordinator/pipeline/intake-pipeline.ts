/**
 * Intake 编排：LLM → parse → guard 链 → RoutedIntakeDecision。
 * 每步打结构化日志，供 Web 运行日志 / 控制台复盘。
 */
import { logAgentOut } from "@fambrain/brain-shared/agent-log";
import type { DbChatTurn } from "@fambrain/brain-types";
import {
  defaultIntakeDecision,
  parseIntakeDecision,
} from "./parse-intake";
import { applyCompositeRouteGuard } from "../composite/composite-route-guard";
import type { RoutedIntakeDecision } from "../composite/composite-route-guard";
import { applyIntakeChitchatGuard } from "../guards/intake-chitchat-guard";
import { applyIntakeRetrievalPlanGuard } from "../guards/intake-retrieval-plan-guard";
import type { IntakeRoutingDecision } from "../contract/prompt";
import { isUserFactIntent } from "@/agentflow/brain-service/online/user-fact";

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

/** clarify / 非检索 intent 的 pipeline 早退包装（与 composite guard 的 skip_non_retrieve 一致） */
export const buildEarlyExitRoutedDecision = (
  decision: IntakeRoutingDecision
): RoutedIntakeDecision => ({
  ...decision,
  routeMode: "single",
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

/** 闲聊 / 超范围等可直接 respondEarly 的 intent */
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
    !decision.needsRetrieval &&
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
 *   ② LLM 指代/澄清决策（透传 + 日志；clarify → pipeline 早退）
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

  /** ② 指代/澄清：完全信任 LLM；clarify 则跳过后续 plan/composite */
  const clarifyEarlyExit = isClarifyEarlyExit(base);
  logAgentOut("IntakeCoordinator", "LLM指代决策", {
    earlyExit: clarifyEarlyExit,
    ...summarizeDecision(base),
  });
  if (clarifyEarlyExit) {
    const decision = buildEarlyExitRoutedDecision(base);
    logAgentOut("IntakeCoordinator", "最终路由", {
      earlyExit: true,
      reason: "clarify",
      ...summarizeDecision(decision),
    });
    return { decision, parseUsedFallback, earlyExit: true };
  }

  /** ③ 闲聊：chitchat 注入服务端固定 briefReply */
  const afterChitchat = applyIntakeChitchatGuard(base);
  logAgentOut("IntakeCoordinator", "guard_闲聊", {
    changed: guardChanged(base, afterChitchat),
    ...summarizeDecision(afterChitchat),
  });

  if (isRespondEarlyIntent(afterChitchat)) {
    const decision = buildEarlyExitRoutedDecision(afterChitchat);
    logAgentOut("IntakeCoordinator", "最终路由", {
      earlyExit: true,
      reason: afterChitchat.intent,
      ...summarizeDecision(decision),
    });
    return { decision, parseUsedFallback, earlyExit: true };
  }

  /** ④ 用户记忆：intent 为 remember/recall → pipeline 早退（解析与读写均在 userFact 节点） */
  const userFactMatched = isUserFactIntent(afterChitchat.intent);
  logAgentOut("IntakeCoordinator", "guard_用户记忆", {
    matched: userFactMatched,
    intent: afterChitchat.intent,
    ...(userFactMatched
      ? {
          userFactKey: afterChitchat.userFactKey,
          userFactLabel: afterChitchat.userFactLabel,
          hasValue: Boolean(afterChitchat.userFactValue?.trim()),
        }
      : {}),
  });

  if (userFactMatched) {
    const decision = buildEarlyExitRoutedDecision(afterChitchat);
    logAgentOut("IntakeCoordinator", "最终路由", {
      earlyExit: true,
      reason: afterChitchat.intent,
      ...summarizeDecision(decision),
    });
    return { decision, parseUsedFallback, earlyExit: true };
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
  return { decision, parseUsedFallback, earlyExit: false };
};
