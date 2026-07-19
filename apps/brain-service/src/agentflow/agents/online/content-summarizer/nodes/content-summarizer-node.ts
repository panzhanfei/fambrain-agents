import { logAgentOut } from "@fambrain/brain-shared/agent-log";
import { buildSummarizeSourceText } from "../build-source-text";
import { formatSummaryAsAnswer } from "../format-answer";
import { isSummarizeComposeDecision } from "../summarize-route";
import { summarizeContent } from "../summarize";
import type { PipelineGraphState } from "@/agentflow/pipeline/graph/state";

/**
 * LangGraph contentSummarizer 节点。
 *
 * - 纯总结（intake 短路）：生成终稿，exitEarly
 * - planExecutor / listRetriever 链内：composeMode=summarize 时生成终稿；qa/composite 透传
 */
export const runContentSummarizerNode = async (
    state: PipelineGraphState
): Promise<Partial<PipelineGraphState>> => {
    const decision = state.decision;
    if (!decision) {
        return {
            answer: "（未能理解摘要请求，请说明要总结的项目或文档）",
            exitEarly: true,
        };
    }

    if (!isSummarizeComposeDecision(decision)) {
        logAgentOut("ContentSummarizer", "跳过", {
            composeMode: decision.composeMode,
            intent: decision.intent,
        });
        return {};
    }

    try {
        const { text, sourceLabel } = buildSummarizeSourceText({
            userQuestion: state.userQuestion,
            decision,
            hits: state.hits,
        });
        if (!text.trim()) {
            return {
                answer: "（没有可摘要的正文，请先说明要总结的项目或粘贴内容）",
                exitEarly: true,
            };
        }
        const summary = await summarizeContent({
            text,
            sourceLabel,
            language: decision.language,
        });
        const answer = formatSummaryAsAnswer(summary);
        logAgentOut("ContentSummarizer", "完成", {
            sourceLabel,
            textChars: text.length,
            exitEarly: true,
        });
        return { answer, exitEarly: true };
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : "内容摘要师调用失败";
        return {
            error: msg,
            answer: "（生成摘要时出错，请稍后重试）",
            exitEarly: true,
        };
    }
};
