import { completeIntakeCoordinator } from "../llm/ollama-chat";
import { matchUiEnumerationPrompt } from "../enumeration";
import {
  buildEnumerationListDecision,
  buildPureChitchatDecision,
  applyIntakeChitchatGuard,
} from "@/agentflow/agents/online/intake-coordinator/guards";
import { isPureSocialUtterance } from "@/agentflow/agents/online/intake-coordinator/signals";
import { buildEarlyExitRoutedDecision } from "../pipeline/intake-pipeline";
import { ENUMERATION_EXHAUSTIVE_PAGE_SIZE } from "@/agentflow/agents/online/knowledge-manager/list/list-corpus-entries";
import { getEnumerationListSession } from "@fambrain/infra";
import { runIntakePipeline } from "../pipeline/intake-pipeline";
import type { PipelineGraphState } from "@/agentflow/pipeline/graph/state";

/**
 * LangGraph intake 节点（图内位于 preparePipelineMemory 之后）。
 *
 * 职责：把用户问句变成 `state.decision`（RoutedIntakeDecision），供 routeAfterIntake 分流。
 * 不做：同问短路（prepareTurnStart）、KM 检索、写终稿、Mem0 读写。
 */
export const runIntakeNode = async (
  state: PipelineGraphState
): Promise<Partial<PipelineGraphState>> => {
  try {
    /**
     * 步骤 0a：纯问候/感谢 — 跳过 LLM，强制 chitchat 早退。
     */
    if (isPureSocialUtterance(state.userQuestion)) {
      const chitchat = applyIntakeChitchatGuard(buildPureChitchatDecision());
      return {
        decision: buildEarlyExitRoutedDecision(chitchat),
      };
    }

    /**
     * 步骤 0b：UI 按钮精确匹配（ENUMERATION_ACTION_PROMPTS）— 不调 LLM。
     * 仅认 Analyst 发出的固定 prompt，无口语 regex 词表。
     */
    const session = {
      conversationId: state.context.conversationId,
      corpusUserId: state.context.corpusUserId,
    };

    const uiControl = matchUiEnumerationPrompt(state.userQuestion);
    if (
      uiControl &&
      (uiControl.action === "continue" || uiControl.action === "exhaustive")
    ) {
      const stored = await getEnumerationListSession(
        session,
        uiControl.listKind
      );
      const page =
        uiControl.action === "continue" ? (stored?.lastPage ?? 1) + 1 : 1;
      const pageSize = stored?.pageSize ?? ENUMERATION_EXHAUSTIVE_PAGE_SIZE;
      return {
        decision: buildEnumerationListDecision({
          userQuestion: state.userQuestion,
          listKind: uiControl.listKind,
          listIntent:
            uiControl.action === "continue" ? "continue" : "exhaustive",
          page,
          pageSize,
        }),
      };
    }

    /** 步骤 1：调 Intake LLM — 结合 intakeHistory + memoryBlock 产出路由 JSON 字符串 */
    const intakeRaw = await completeIntakeCoordinator(state.intakeHistory, {
      memoryBlock: state.memoryBlock,
      intakeHistory: state.intakeHistory,
    });

    /** 步骤 2：parse + guard 链 — 含按槽 enumerationControl → executor */
    const { decision } = await runIntakePipeline({
      intakeRaw,
      userQuestion: state.userQuestion,
      intakeHistory: state.intakeHistory,
      session,
    });
    return { decision };
  } catch (e) {
    /** Ollama 不可用或 invoke 失败：标记早退 */
    const msg =
      e instanceof Error ? e.message : "入口接线员调用失败，请确认 Ollama 可用";
    return {
      error: msg,
      answer: "（模型调用失败：请确认本地 Ollama 已启动且模型已拉取）",
      exitEarly: true,
    };
  }
};
