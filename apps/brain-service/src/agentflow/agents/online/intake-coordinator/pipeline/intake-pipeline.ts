/**
 * Intake 编排：LLM → parse → guard 链 → RoutedIntakeDecision。
 * 每步打结构化日志，供 Web 运行日志 / 控制台复盘。
 *
 * 复盘沙盘（逐步看 decision 变化）：Cursor Canvas「intake-pipeline-sandbox」
 * 字段词典：Cursor Canvas「intake-field-dictionary」
 * 类型：IntakeRoutingDecision（LLM）→ RoutedIntakeDecision（本文件出口）→ state.decision
 */
import {
  applyCompositeRouteGuard,
  applyIntakeChitchatGuard,
  applyIntakeRetrievalPlanGuard,
  applyEnumerationSlotGuard,
  applyIntakeContinuationGuard,
  applyIntakeLinkLookupGuard,
  applyPureSocialUtteranceGuard,
  type RoutedIntakeDecision,
} from "@/agentflow/agents/online/intake-coordinator/guards";
import {
  clarifyFallbackFromProse,
  defaultIntakeDecision,
  parseIntakeDecision,
} from "./parse-intake";
import { applyToolPlanGuard } from "@/agentflow/agents/online/tool-orchestrator";
import type { IntakeRoutingDecision } from "@/agentflow/agents/online/intake-coordinator/contract";
import { IDENTITY_FIELD_SEARCH } from "@/agentflow/agents/online/intake-coordinator/composite";
import {
  applyPathPlanGuard,
  defaultComposeMode,
  emptyPathPlan,
} from "@/agentflow/agents/online/intake-coordinator/path-plan";
import { isUserFactIntent } from "@/agentflow/agents/online/user-fact";
import {
  historySupportsContinuation,
  isShortContinuationUtterance,
} from "@/agentflow/agents/online/intake-coordinator/signals";
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
  /** true：clarify/chitchat 等在 ⑤ 之前早退；无效 recall remap 后继续检索则 false */
  earlyExit: boolean;
};

/**
 * Intake 规则主流程（LLM 之后）：parse → guard 链 → RoutedIntakeDecision。
 *
 * 步骤一览（Δ = 常变字段；与 Canvas 沙盘步骤 id 对齐）：
 *   ①   parse+兜底     Δ intent/searchQuery/clarifyingQuestion（失败才变）
 *   ①b  纯社交         Δ intent→chitchat, briefReply 注入
 *   ②a  续问 repair    Δ intent→retrieve, searchQuery, queryType, clarifyingQuestion=null
 *   ②   clarify 早退   → Routed skip + empty pathPlan；earlyExit
 *   ③   闲聊           Δ briefReply=固定话术
 *   ③b  非检索早退     → 同 ② 包装；earlyExit
 *   ④   userFact       合法→早退；无效 recall→Δ intent/retrievalPlan identity（继续）
 *   ⑤a  外链           Δ retrievalPlan.queryType / searchQuery / topics
 *   ⑤   检索计划       schema 合法化/去重/canonicalize（不发明槽）
 *   ⑥   复合路由       + routeMode/compositeSlots（信 retrievalPlan 编译）
 *   ⑦   列举           Δ slot.executor=list_corpus, listIntent/page
 *   ⑧   工具           + enrichedPlan/toolId；或 routeMode=dag+executionPlan
 *   ⑨   PathPlan       + pathPlan 四桶, composeMode；slot enrich
 *   ⑩   出口           return → state.decision → routeAfterIntake
 */
export const runIntakePipeline = async (
  input: RunIntakePipelineInput
): Promise<RunIntakePipelineResult> => {
  /** ① 解析 + 兜底：JSON/Zod → IntakeRoutingDecision；失败则散文 clarify 或 default retrieve */
  const parsed = parseIntakeDecision(input.intakeRaw);
  const proseClarify =
    parsed === null ? clarifyFallbackFromProse(input.intakeRaw) : null;
  const parseUsedFallback = parsed === null && proseClarify === null;
  let decision =
    parsed ?? proseClarify ?? defaultIntakeDecision(input.userQuestion);

  /**
   * ①+ 解析失败落到 default retrieve，且当前为无上文短续问：
   * 禁止带着指代原文去查库 → 改 clarify（与 G5 / 档 B 一致）。
   */
  if (
    parseUsedFallback &&
    decision.intent === "retrieve_and_answer" &&
    isShortContinuationUtterance(input.userQuestion) &&
    !historySupportsContinuation(input.intakeHistory)
  ) {
    decision = {
      ...decision,
      intent: "clarify",
      searchQuery: "",
      queryType: null,
      clarifyingQuestion:
        decision.clarifyingQuestion?.trim() ||
        "你指的是哪一段经历或哪个项目？请补充具体名称。",
      briefReply: null,
      retrievalPlan: [],
      confidence: Math.min(decision.confidence, 0.55),
    };
  }

  logAgentOut("IntakeCoordinator", "解析LLM输出", {
    parseOk: parsed !== null,
    ...(parsed === null
      ? {
          fallbackReason: proseClarify
            ? "JSON 解析失败，散文含问号 → clarifyFallbackFromProse"
            : "JSON 解析或 Zod 校验失败，使用 defaultIntakeDecision",
        }
      : {}),
    ...summarizeDecision(decision),
  });

  /** ①b 纯问候/感谢：覆盖 LLM 误判 retrieve（入口未短路时的兜底） */
  const afterPureSocial = applyPureSocialUtteranceGuard(
    decision,
    input.userQuestion
  );
  if (afterPureSocial.intent !== decision.intent) {
    logAgentOut("IntakeCoordinator", "guard_纯社交短路", {
      fromIntent: decision.intent,
      toIntent: afterPureSocial.intent,
    });
  }
  decision = afterPureSocial;

  /** ②a 续问/指代：省略主语或误 clarify → retrieve（在 clarify 早退之前） */
  const afterContinuation = applyIntakeContinuationGuard(
    decision,
    input.userQuestion,
    input.intakeHistory
  );
  if (afterContinuation.continuationGuardReason !== "noop") {
    logAgentOut("IntakeCoordinator", "guard_续问指代", {
      reason: afterContinuation.continuationGuardReason,
      ...summarizeDecision(afterContinuation),
    });
  }
  decision = afterContinuation;

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

  /** ④ 用户记忆：remember/recall → userFact；无效 recall 无 key → 下方 remap 后继续 ⑤ */
  if (isUserFactIntent(decision.intent)) {
    const factKey = decision.userFactKey?.trim() ?? "";
    /**
     * 无效 recall（缺 userFactKey）：纠正 intent，不发明用户口语语义。
     * 档 B：若 LLM 已给出可用 retrievalPlan → 原样保留，只改成 retrieve_and_answer。
     * 仅当 plan 为空时，才回退单槽 identity/name（schema 兜底，非口语猜题）。
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
        const field = "name" as const;
        const fieldSpec = IDENTITY_FIELD_SEARCH[field];
        decision = {
          ...decision,
          intent: "retrieve_and_answer",
          queryType: "identity",
          searchQuery: fieldSpec.searchQuery,
          topics: ["personal", "resume"],
          subTasks:
            decision.subTasks.length > 0
              ? decision.subTasks
              : [fieldSpec.displayLabel],
          retrievalPlan: [
            {
              label: fieldSpec.displayLabel,
              searchQuery: fieldSpec.searchQuery,
              queryType: "identity",
              topics: ["personal", "resume"],
              identityField: field,
              enumerationControl: null,
            },
          ],
          userFactKey: null,
          userFactLabel: null,
          userFactValue: null,
          clarifyingQuestion: null,
          briefReply: null,
        };
        logAgentOut("IntakeCoordinator", "guard_用户记忆", {
          matched: false,
          remapped: "invalid_recall_to_identity_retrieve",
          identityField: field,
          ...summarizeDecision(decision),
        });
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

  /** ⑤a 对外链接：纠正 GitHub/URL 问法误标 enumeration */
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

  /** ⑥ 复合路由：plan → compositeSlots；定 routeMode（skip / slots / list / dag） */
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

  /** ⑦ 列举分页：按槽 executor=list_corpus（LLM enumerationControl 或 UI exact-match） */
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

  /** ⑧ 工具计划：dataSource / toolId（不再整轮互斥切 dag） */
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

  /** ⑩ 出口：decision 写入 state，由 routeAfterIntake → planExecutor */
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
