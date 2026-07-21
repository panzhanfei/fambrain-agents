/**
 * 多轮续问 guard：短句续问 / 误 clarify → retrieve；queryType 继承 decision 或 history 中的 URL 结构信号。
 * 若 LLM 已给出实质 searchQuery（≠ 短句原文），不覆盖。
 *
 * 注：指代未消解时 intake-node 会拼接上轮再调 LLM 一次；本 guard 兜底仍省略/误 clarify 的 elliptical。
 */
import type { DbChatTurn } from "@fambrain/brain-types";
import type { IntakeRoutingDecision } from "@/agentflow/agents/online/intake-coordinator/contract";
import { EXTERNAL_LINK_SLOT } from "@/agentflow/agents/online/intake-coordinator/composite";
import { isUserFactIntent } from "@/agentflow/agents/online/user-fact";
import {
  decisionRequestsExternalLink,
  historyContainsUrl,
  historySupportsContinuation,
  isShortContinuationUtterance,
  lastSubstantiveUserQuestion,
} from "../signals";

export type IntakeContinuationGuardReason =
  | "noop"
  | "elliptical_retrieve"
  | "clarify_to_retrieve";

export const applyIntakeContinuationGuard = (
  decision: IntakeRoutingDecision,
  userQuestion: string,
  history: DbChatTurn[]
): IntakeRoutingDecision & {
  continuationGuardReason?: IntakeContinuationGuardReason;
} => {
  /** 步骤 1：userFact 独立分支，勿改写成 retrieve */
  if (isUserFactIntent(decision.intent)) {
    return { ...decision, continuationGuardReason: "noop" };
  }

  /**
   * 步骤 2：无「可续问」上文则跳过。
   * 条件：history 里已有 assistant 回复（≥8 字），或至少 2 条 user 问。
   */
  if (!historySupportsContinuation(history)) {
    return { ...decision, continuationGuardReason: "noop" };
  }

  /**
   * 步骤 3：判断是否属于续问/误路由形态（二选一）：
   * - elliptical：当前句极短（≤32 字、无编号多问），如「那前端呢？」
   * - clarifyMisroute：LLM 标 clarify 且带 clarifyingQuestion，但有 history 时可能是误路由
   */
  const elliptical = isShortContinuationUtterance(userQuestion);
  const clarifyMisroute =
    decision.intent === "clarify" &&
    Boolean(decision.clarifyingQuestion?.trim());

  if (!elliptical && !clarifyMisroute) {
    return { ...decision, continuationGuardReason: "noop" };
  }

  /**
   * 步骤 4：是否外链话题（external_link = 查 GitHub/仓库 URL 等对外链接，非口语词表）：
   * - LLM decision 已标 queryType=external_link，或 retrievalPlan 含该类型
   * - 或 history 里出现过 https:// URL
   */
  const linkTopic =
    decisionRequestsExternalLink(decision) || historyContainsUrl(history);

  /**
   * 步骤 5：LLM 是否已自行补全检索词（retrieve + searchQuery≥8 且 ≠ 当前短句）。
   * clarify 误路由时不算「已补全」，仍要走 repair。
   */
  const llmQuery = decision.searchQuery.trim();
  const llmAlreadyResolved =
    decision.intent === "retrieve_and_answer" &&
    llmQuery.length >= 8 &&
    llmQuery !== userQuestion.trim() &&
    !clarifyMisroute;

  /** 步骤 6：LLM 检索词已够用且非外链续问 → 不覆盖 */
  if (llmAlreadyResolved && !linkTopic) {
    return { ...decision, continuationGuardReason: "noop" };
  }

  /** 步骤 7：取当前问句之前最近一条实质 user 问，作 searchQuery 兜底 */
  const prior = lastSubstantiveUserQuestion(history, userQuestion);

  /**
   * 步骤 8：拼 searchQuery（优先级）：
   * 外链 → EXTERNAL_LINK_SLOT 固定检索词；
   * 否则 LLM 已补全 → 用 llmQuery；
   * 否则 → 上轮 user 问（prior），再否则当前句；截断 240 字。
   */
  const searchQuery = linkTopic
    ? EXTERNAL_LINK_SLOT.searchQuery
    : (llmAlreadyResolved ? llmQuery : (prior ?? userQuestion).trim()).slice(
        0,
        240
      );

  /** 步骤 9：queryType — 外链续问强制 external_link，否则保留 LLM 的 */
  const queryType = linkTopic
    ? "external_link"
    : (decision.queryType ?? "default");

  /**
   * 步骤 10：改写为 retrieve_and_answer，清空 clarify/briefReply，保留或补 subTasks。
   * reason：elliptical_retrieve | clarify_to_retrieve（供日志复盘）。
   */
  return {
    ...decision,
    intent: "retrieve_and_answer",
    searchQuery,
    queryType,
    topics: linkTopic ? [...EXTERNAL_LINK_SLOT.topics] : decision.topics,
    subTasks:
      decision.subTasks.length > 0
        ? decision.subTasks
        : prior
          ? [prior.slice(0, 80)]
          : decision.subTasks,
    clarifyingQuestion: null,
    briefReply: null,
    retrievalPlan: decision.retrievalPlan ?? [],
    confidence: Math.max(decision.confidence, 0.82),
    continuationGuardReason: elliptical
      ? "elliptical_retrieve"
      : "clarify_to_retrieve",
  };
};
