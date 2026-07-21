import { completeIntakeCoordinator } from "../llm/ollama-chat";
import { matchUiEnumerationPrompt } from "../enumeration";
import {
  buildEnumerationListDecision,
  buildIncompleteUtteranceDecision,
  buildPureChitchatDecision,
  applyIntakeChitchatGuard,
} from "@/agentflow/agents/online/intake-coordinator/guards";
import {
  isPureSocialUtterance,
  normalizeIntakeUtterance,
  rewriteLastUserTurn,
  shouldRetryCoreferenceMerge,
  shouldShortCircuitIncompleteUtterance,
} from "@/agentflow/agents/online/intake-coordinator/signals";
import { logAgentOut } from "@fambrain/brain-shared/agent-log";
import { buildEarlyExitRoutedDecision } from "../pipeline/intake-pipeline";
import { ENUMERATION_EXHAUSTIVE_PAGE_SIZE } from "@/agentflow/agents/online/corpus-lister/list";
import { getEnumerationListSession } from "@fambrain/infra";
import { parseIntakeDecision } from "../pipeline/parse-intake";
import { runIntakePipeline } from "../pipeline/intake-pipeline";
import type { PipelineGraphState } from "@/agentflow/pipeline/graph/state";

/**
 * LangGraph intake 节点（图内位于 preparePipelineMemory 之后）。
 *
 * 入口短路：0a 社交 / 0a2 单字（normalize 后）/ 0b UI 按钮
 * 否则：normalize 问句 → LLM →（非 JSON 则格式修复 1×）→（JSON 指代未消解则拼接 1×）→ pipeline
 */
export const runIntakeNode = async (
  state: PipelineGraphState
): Promise<Partial<PipelineGraphState>> => {
  try {
    const rawQuestion = state.userQuestion;
    const normalizedQuestion =
      normalizeIntakeUtterance(rawQuestion) || rawQuestion.trim() || rawQuestion;

    if (
      isPureSocialUtterance(normalizedQuestion) ||
      isPureSocialUtterance(rawQuestion)
    ) {
      const chitchat = applyIntakeChitchatGuard(buildPureChitchatDecision());
      return {
        decision: buildEarlyExitRoutedDecision(chitchat),
      };
    }

    if (
      shouldShortCircuitIncompleteUtterance(
        normalizedQuestion,
        state.intakeHistory
      )
    ) {
      const incomplete = buildIncompleteUtteranceDecision();
      logAgentOut("IntakeCoordinator", "短路_单字残缺", {
        userQuestion: rawQuestion,
        normalizedQuestion,
      });
      return {
        decision: buildEarlyExitRoutedDecision(incomplete),
      };
    }

    const session = {
      conversationId: state.context.conversationId,
      corpusUserId: state.context.corpusUserId,
    };

    /** UI 按钮仍对用户原文 exact-match（不经 collapse） */
    const uiControl = matchUiEnumerationPrompt(rawQuestion);
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
          userQuestion: rawQuestion,
          listKind: uiControl.listKind,
          listIntent:
            uiControl.action === "continue" ? "continue" : "exhaustive",
          page,
          pageSize,
        }),
      };
    }

    /** 步骤 1：用 normalize 后问句调 LLM（压重复字，省 token） */
    let effectiveQuestion = normalizedQuestion;
    let intakeHistoryForLlm =
      normalizedQuestion !== rawQuestion.trim()
        ? rewriteLastUserTurn(state.intakeHistory, normalizedQuestion)
        : state.intakeHistory;

    let intakeRaw = await completeIntakeCoordinator(intakeHistoryForLlm, {
      memoryBlock: state.memoryBlock,
      intakeHistory: intakeHistoryForLlm,
    });

    /** 步骤 1a：只认 JSON peek；散文 → 格式修复 1 次（不触发指代拼接） */
    let peek = parseIntakeDecision(intakeRaw);
    if (!peek) {
      logAgentOut("IntakeCoordinator", "JSON格式修复重试", {
        userQuestion: effectiveQuestion,
        rawPreview:
          intakeRaw.length > 200 ? `${intakeRaw.slice(0, 200)}…` : intakeRaw,
      });
      intakeRaw = await completeIntakeCoordinator(intakeHistoryForLlm, {
        memoryBlock: state.memoryBlock,
        intakeHistory: intakeHistoryForLlm,
        jsonFormatRepair: true,
      });
      peek = parseIntakeDecision(intakeRaw);
    }

    /**
     * 步骤 1b：JSON 指代未消解 → 拼接上轮后再调 1 次。
     * peek=null（仍非 JSON）不拼接；交 pipeline 散文/default 兜底。
     */
    const mergeRetry = shouldRetryCoreferenceMerge(
      peek,
      effectiveQuestion,
      state.intakeHistory
    );
    if (mergeRetry.retry && mergeRetry.mergedQuestion) {
      effectiveQuestion = mergeRetry.mergedQuestion;
      intakeHistoryForLlm = rewriteLastUserTurn(
        state.intakeHistory,
        effectiveQuestion
      );
      logAgentOut("IntakeCoordinator", "指代拼接重试", {
        original: rawQuestion,
        normalizedQuestion,
        prior: mergeRetry.prior,
        effectiveQuestion,
        peekCoreference: peek?.coreference ?? null,
        peekIntent: peek?.intent ?? null,
      });
      intakeRaw = await completeIntakeCoordinator(intakeHistoryForLlm, {
        memoryBlock: state.memoryBlock,
        intakeHistory: intakeHistoryForLlm,
        coreferenceMergeRetry: true,
      });
    }

    const { decision } = await runIntakePipeline({
      intakeRaw,
      userQuestion: effectiveQuestion,
      intakeHistory: intakeHistoryForLlm,
      session,
    });
    return { decision };
  } catch (e) {
    const msg =
      e instanceof Error ? e.message : "入口接线员调用失败，请确认 Ollama 可用";
    return {
      error: msg,
      answer: "（模型调用失败：请确认本地 Ollama 已启动且模型已拉取）",
      exitEarly: true,
    };
  }
};
