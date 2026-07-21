/**
 * Intake 编排（LLM 之后）：parse → early-exit → legalize → compile → RoutedIntakeDecision。
 * 每步打结构化日志，供 Web 运行日志 / 控制台复盘。
 *
 * 复盘沙盘（逐步看 decision 变化）：Cursor Canvas「intake-pipeline-sandbox」
 * 字段词典：Cursor Canvas「intake-field-dictionary」
 * 类型：IntakeRoutingDecision（LLM）→ RoutedIntakeDecision（本文件出口）→ state.decision
 *
 * 档 B：LLM 写出完整 retrievalPlan；代码只合法化 + 编译；空 plan → clarify。
 * 纯社交短路在 intake-node；continuation 恒 noop。
 */
import {
  applyCompositeRouteGuard,
  applyIntakeChitchatGuard,
  applyIntakeRetrievalPlanGuard,
  applyEnumerationSlotGuard,
  applyIntakeContinuationGuard,
  applyIntakeLinkLookupGuard,
  type RoutedIntakeDecision,
} from "@/agentflow/agents/online/intake-coordinator/guards";
import {
  clarifyFallbackFromProse,
  defaultIntakeDecision,
  parseIntakeDecision,
} from "./parse-intake";
import { applyToolPlanGuard } from "@/agentflow/agents/online/tool-orchestrator";
import type { IntakeRoutingDecision } from "@/agentflow/agents/online/intake-coordinator/contract";
import {
  applyPathPlanGuard,
  defaultComposeMode,
  emptyPathPlan,
} from "@/agentflow/agents/online/intake-coordinator/path-plan";
import { isUserFactIntent } from "@/agentflow/agents/online/user-fact";
import { logAgentOut } from "@fambrain/brain-shared/agent-log";
import type { DbChatTurn } from "@fambrain/brain-types";
import type { CompositeSessionKey } from "@fambrain/infra";

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

/**
 * 早退包装：把 IntakeRoutingDecision 升成 RoutedIntakeDecision，但不安排检索。
 * 写入：routeMode=skip, compositeSlots=[], pathPlan 空, routeReason=skip_non_retrieve
 * → routeAfterIntake → respondEarly | userFact（视 intent）
 */
export const buildEarlyExitRoutedDecision = (
  decision: IntakeRoutingDecision
): RoutedIntakeDecision => ({
  ...decision,
  routeMode: "skip",
  compositeSlots: [],
  pathPlan: emptyPathPlan(),
  composeMode: defaultComposeMode(),
  routeReason: "skip_non_retrieve",
  routePlanSource: "none",
});

/** LLM 判定需反问（无上下文或指代无法消解）→ pipeline 早退 */
export const isClarifyEarlyExit = (decision: IntakeRoutingDecision): boolean =>
  decision.intent === "clarify" && Boolean(decision.clarifyingQuestion?.trim());

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
    decision.intent === "direct_answer" && Boolean(decision.briefReply?.trim())
  );
};

export type RunIntakePipelineInput = {
  intakeRaw: string;
  userQuestion: string;
  intakeHistory: DbChatTurn[];
  /** 列举续页读 session；缺省则无法解析 continue 页码 */
  session?: CompositeSessionKey;
};

export type RunIntakePipelineResult = {
  decision: RoutedIntakeDecision;
  parseUsedFallback: boolean;
  /** true：clarify/chitchat/userFact 等早退；继续检索则为 false */
  earlyExit: boolean;
};

/**
 * Intake 规则主流程（LLM 之后）：parse → early-exit → legalize → compile。
 *
 * 步骤一览：
 *   ①   parse+兜底（失败 → clarify）
 *   ②a  continuation（恒 noop）
 *   ②   clarify 早退
 *   ③   闲聊 briefReply
 *   ③b  非检索早退
 *   ④   userFact；无效 recall：有 plan→retrieve；无 plan→clarify
 *   ⑤a  外链 harmonize
 *   ⑤   检索计划合法化/去重/canonicalize
 *   ⑥   复合路由：plan→slots；空 plan→clarify 早退
 *   ⑦⑧⑨ 列举 / 工具 / PathPlan
 *   ⑩   出口
 */
export const runIntakePipeline = async (
  input: RunIntakePipelineInput
): Promise<RunIntakePipelineResult> => {
  /** ① 解析 + 兜底：失败 → 散文 clarify 或 defaultClarify */
  const parsed = parseIntakeDecision(input.intakeRaw);
  const proseClarify =
    parsed === null ? clarifyFallbackFromProse(input.intakeRaw) : null;
  const parseUsedFallback = parsed === null && proseClarify === null;
  let decision =
    parsed ?? proseClarify ?? defaultIntakeDecision(input.userQuestion);

  logAgentOut("IntakeCoordinator", "解析LLM输出", {
    parseOk: parsed !== null,
    ...(parsed === null
      ? {
          fallbackReason: proseClarify
            ? "JSON 解析失败，散文含问号 → clarifyFallbackFromProse"
            : "JSON 解析或 Zod 校验失败，使用 defaultIntakeDecision(clarify)",
        }
      : {}),
    ...summarizeDecision(decision),
  });

  /** ②a continuation：恒 noop（指代归 LLM + node merge） */
  decision = applyIntakeContinuationGuard(
    decision,
    input.userQuestion,
    input.intakeHistory
  );

  /** ② clarify 早退 */
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

  /** ③b 非检索 intent 早退 → respondEarly */
  if (isRespondEarlyIntent(decision)) {
    const routed = buildEarlyExitRoutedDecision(decision);
    logAgentOut("IntakeCoordinator", "最终路由", {
      earlyExit: true,
      reason: decision.intent,
      ...summarizeDecision(routed),
    });
    return { decision: routed, parseUsedFallback, earlyExit: true };
  }

  /** ④ 用户记忆：remember/recall → userFact；无效 recall 见下 */
  if (isUserFactIntent(decision.intent)) {
    const factKey = decision.userFactKey?.trim() ?? "";
    /**
     * 无效 recall（缺 userFactKey）：
     * - 已有可用 retrievalPlan → 改成 retrieve，保留 plan（不发明槽）
     * - plan 为空 → clarify 早退（不再发明 identity/name）
     */
    if (decision.intent === "recall_user_fact" && !factKey) {
      const plan = decision.retrievalPlan ?? [];
      const hasUsablePlan = plan.some(
        (p) =>
          Boolean(p.searchQuery?.trim()) ||
          p.queryType === "enumeration" ||
          p.queryType === "identity" ||
          Boolean(p.identityField) ||
          Boolean(p.enumerationControl)
      );
      if (hasUsablePlan) {
        decision = {
          ...decision,
          intent: "retrieve_and_answer",
          userFactKey: null,
          userFactLabel: null,
          userFactValue: null,
          clarifyingQuestion: null,
          briefReply: null,
        };
        logAgentOut("IntakeCoordinator", "guard_用户记忆", {
          matched: false,
          remapped: "invalid_recall_keep_retrieval_plan",
          ...summarizeDecision(decision),
        });
      } else {
        decision = {
          ...decision,
          intent: "clarify",
          searchQuery: "",
          queryType: null,
          clarifyingQuestion:
            decision.clarifyingQuestion?.trim() ||
            "你想回忆哪一条个人设定？请说明关键词（例如昵称、偏好）。",
          briefReply: null,
          retrievalPlan: [],
          userFactKey: null,
          userFactLabel: null,
          userFactValue: null,
          confidence: Math.min(decision.confidence, 0.55),
        };
        logAgentOut("IntakeCoordinator", "guard_用户记忆", {
          matched: false,
          remapped: "invalid_recall_to_clarify",
          ...summarizeDecision(decision),
        });
        const routed = buildEarlyExitRoutedDecision(decision);
        logAgentOut("IntakeCoordinator", "最终路由", {
          earlyExit: true,
          reason: "clarify",
          ...summarizeDecision(routed),
        });
        return { decision: routed, parseUsedFallback, earlyExit: true };
      }
    } else {
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
  }

  /** ⑤a 对外链接：纠正误标 enumeration 等（信 queryType / plan 结构） */
  const afterLinkLookup = applyIntakeLinkLookupGuard(
    decision,
    input.userQuestion
  );
  if (afterLinkLookup.linkLookupGuardReason !== "noop") {
    logAgentOut("IntakeCoordinator", "guard_对外链接", {
      reason: afterLinkLookup.linkLookupGuardReason,
      ...summarizeDecision(afterLinkLookup),
    });
  }
  decision = afterLinkLookup;

  /** ⑤ 检索计划：schema 合法化 / 去重 / canonicalize（不发明多槽） */
  const afterPlan = applyIntakeRetrievalPlanGuard(decision, input.userQuestion);
  logAgentOut("IntakeCoordinator", "guard_检索计划", {
    reason: afterPlan.retrievalPlanGuardReason ?? "noop",
    changed: guardChanged(decision, afterPlan),
    retrievalPlanCount: afterPlan.retrievalPlan.length,
    retrievalPlanLabels: afterPlan.retrievalPlan.map((p) => p.label),
  });
  decision = afterPlan;

  /** ⑥ 复合路由：plan → compositeSlots；空 plan → clarify 早退 */
  const routed = applyCompositeRouteGuard(decision, input.userQuestion);
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

  if (routed.routeMode === "skip" || isClarifyEarlyExit(routed)) {
    logAgentOut("IntakeCoordinator", "最终路由", {
      earlyExit: true,
      reason: routed.intent,
      ...summarizeDecision(routed),
    });
    return { decision: routed, parseUsedFallback, earlyExit: true };
  }

  /** ⑦ 列举分页：按槽 executor=list_corpus */
  const sessionKey: CompositeSessionKey = input.session ?? {
    conversationId: "_",
    corpusUserId: "_",
  };
  const withListIntent = await applyEnumerationSlotGuard(
    routed,
    input.userQuestion,
    sessionKey
  );
  const listSlots = withListIntent.compositeSlots.filter(
    (s) => s.executor === "list_corpus"
  );
  if (listSlots.length > 0) {
    logAgentOut("IntakeCoordinator", "guard_列举分页", {
      listSlotCount: listSlots.length,
      listIntent: withListIntent.listIntent,
      page: withListIntent.enumerationPage,
      pageSize: withListIntent.enumerationPageSize,
      listKind: withListIntent.enumerationListKind,
      slotExecutors: withListIntent.compositeSlots.map((s) => ({
        id: s.id,
        executor: s.executor ?? "km_retrieve",
        action: s.enumerationControl?.action ?? null,
      })),
    });
  }

  /** ⑧ 工具计划：dataSource / toolId */
  const withToolPlan = applyToolPlanGuard(withListIntent, input.userQuestion);
  if (
    withToolPlan.routeMode === "dag" ||
    (withToolPlan.enrichedPlan ?? []).some((p) => p.toolId)
  ) {
    logAgentOut("IntakeCoordinator", "guard_工具计划", {
      routeMode: withToolPlan.routeMode,
      executionPlanCount: withToolPlan.executionPlan?.length ?? 0,
      enrichedToolIds: (withToolPlan.enrichedPlan ?? [])
        .map((p) => p.toolId)
        .filter(Boolean),
    });
  }

  /** ⑨ PathPlan：编译四桶 + composeMode */
  const withPathPlan = applyPathPlanGuard(withToolPlan, input.userQuestion);
  logAgentOut("IntakeCoordinator", "guard_PathPlan", {
    composeMode: withPathPlan.composeMode,
    km: withPathPlan.pathPlan.km.length,
    list: withPathPlan.pathPlan.list.length,
    tool: withPathPlan.pathPlan.tool.length,
    dag: withPathPlan.pathPlan.dag.map((d) => d.template),
    routeMode: withPathPlan.routeMode,
  });

  /** ⑩ 出口 */
  logAgentOut("IntakeCoordinator", "最终路由", {
    ...summarizeDecision(withPathPlan),
    composeMode: withPathPlan.composeMode,
    pathPlanCounts: {
      km: withPathPlan.pathPlan.km.length,
      list: withPathPlan.pathPlan.list.length,
      tool: withPathPlan.pathPlan.tool.length,
      dag: withPathPlan.pathPlan.dag.length,
    },
  });
  return { decision: withPathPlan, parseUsedFallback, earlyExit: false };
};
