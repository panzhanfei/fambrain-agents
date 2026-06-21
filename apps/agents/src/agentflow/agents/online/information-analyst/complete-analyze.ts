import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ChatOllama } from "@langchain/ollama";
import { getAgentsConfig } from "@fambrain/agent-config";
import { logAgentOut } from "@fambrain/agent-shared/agent-log";
import { streamOllamaNative } from "@fambrain/agent-shared/ollama-native-stream";
import { dedupeCitations } from "@/agentflow/agents/online/content-organizer";
import { parseJsonObject, textFromResponse } from "@/agentflow/utils";
import {
    buildSubQuestionFallbackAnswer,
    normalizeAnalystResult,
    shouldSkipSubQuestionLlm,
    type SubQuestionAnalyzeInput,
} from "./analyze-helpers";
import {
    subQuestionPrompt,
    subQuestionStreamPrompt,
} from "./sub-question-prompt";
import type { InformationAnalystResult } from "./prompt";

export const MAX_SUB_QUESTION_HITS = 4;

type SubQuestionStreamChunk = { type: "assistant"; text: string };

const { ollama } = getAgentsConfig();
const llm = new ChatOllama({
    baseUrl: ollama.baseUrl,
    model: ollama.models.intakeCoordinator,
});

const buildSubQuestionResult = (
    input: SubQuestionAnalyzeInput,
    answer: string,
    insufficientEvidence: boolean
): InformationAnalystResult => {
    const hits = input.hits.slice(0, MAX_SUB_QUESTION_HITS);
    const citations = insufficientEvidence
        ? []
        : dedupeCitations(
              hits.slice(0, 2).map((h) => ({
                  path: h.path,
                  excerpt: h.excerpt,
              }))
          );
    return {
        answer: answer.trim(),
        citations,
        confidence: insufficientEvidence ? 0.85 : 0.75,
        insufficientEvidence,
    };
};

/** 单个子问题流式 Analyst（composite 顺序段内 token 输出） */
export async function* streamAnalyzeSubQuestion(
    input: SubQuestionAnalyzeInput
): AsyncGenerator<SubQuestionStreamChunk, InformationAnalystResult> {
    const hits = input.hits.slice(0, MAX_SUB_QUESTION_HITS);
    const payload = { ...input, hits };
    const fallback = buildSubQuestionFallbackAnswer(payload);

    if (shouldSkipSubQuestionLlm(payload)) {
        yield { type: "assistant", text: fallback.answer };
        return fallback;
    }

    let fullContent = "";
    try {
        for await (const chunk of streamOllamaNative({
            messages: [
                { role: "system", content: subQuestionStreamPrompt },
                { role: "user", content: JSON.stringify(payload) },
            ],
            think: false,
            model: ollama.models.intakeCoordinator,
        })) {
            if (chunk.kind !== "content") continue;
            fullContent = chunk.fullText.trim();
            if (fullContent) {
                yield { type: "assistant", text: fullContent };
            }
        }
        const answer = fullContent || fallback.answer;
        const result = buildSubQuestionResult(
            payload,
            answer,
            hits.length === 0 || input.coverage === "none"
        );
        logAgentOut("InformationAnalyst", "子问流式出去", {
            label: input.userQuestion,
            hitCount: hits.length,
            answerPreview:
                result.answer.length > 120
                    ? `${result.answer.slice(0, 120)}…`
                    : result.answer,
        });
        return result;
    } catch (e) {
        logAgentOut("InformationAnalyst", "子问流式出去", {
            label: input.userQuestion,
            source: "fallback_error",
            error: e instanceof Error ? e.message : String(e),
        });
        yield { type: "assistant", text: fallback.answer };
        return fallback;
    }
}

/** 单个子问题非流式 Analyst（短路径 / 测试） */
export const completeAnalyzeSubQuestion = async (
    input: SubQuestionAnalyzeInput
): Promise<InformationAnalystResult> => {
    const hits = input.hits.slice(0, MAX_SUB_QUESTION_HITS);
    const payload = { ...input, hits };
    const fallback = buildSubQuestionFallbackAnswer(payload);

    if (shouldSkipSubQuestionLlm(payload)) {
        logAgentOut("InformationAnalyst", "子问出去", {
            label: input.userQuestion,
            source: "rules_empty_hits_skip_llm",
            hitCount: hits.length,
        });
        return fallback;
    }

    try {
        const ai = await llm.invoke([
            new SystemMessage(subQuestionPrompt),
            new HumanMessage(JSON.stringify(payload)),
        ]);
        const raw = textFromResponse(ai.content);
        const parsed = parseJsonObject<InformationAnalystResult>(raw);
        const result = normalizeAnalystResult(parsed, fallback);
        logAgentOut("InformationAnalyst", "子问出去", {
            label: input.userQuestion,
            source: parsed ? "llm" : "fallback_parse",
            hitCount: hits.length,
            answerPreview:
                result.answer.length > 120
                    ? `${result.answer.slice(0, 120)}…`
                    : result.answer,
        });
        return result;
    } catch (e) {
        logAgentOut("InformationAnalyst", "子问出去", {
            label: input.userQuestion,
            source: "fallback_error",
            error: e instanceof Error ? e.message : String(e),
        });
        return fallback;
    }
};
