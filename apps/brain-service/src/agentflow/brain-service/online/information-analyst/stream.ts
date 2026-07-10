import { getBrainServiceConfig } from "@fambrain/brain-config";
import { logAgentIn, logAgentOut } from "@fambrain/brain-shared/agent-log";
import { estimateTokenUsage, recordPipelineTokenUsage, } from "@fambrain/brain-shared/pipeline-run-context";
import { streamOllamaNative } from "@fambrain/brain-shared/ollama-native-stream";
import { parseJsonObject } from "@/agentflow/utils";
import {
    maxAnalystHitsForProfile,
    prefersPlainTextAnalystStream,
    resolveAnalystQueryProfile,
} from "./analyst-recall-limits";
import {
    buildFallbackAnswer,
    normalizeAnalystResult,
    shouldSkipAnalystLlm,
    toSubQuestionInput,
} from "./analyze-helpers";
import { streamAnalyzeSubQuestion } from "./complete-analyze";
import {
    prompt,
    type InformationAnalystInput,
    type InformationAnalystResult,
} from "./prompt";
import { cachedFacetToAnalystResult } from "@/agentflow/brain-service/online/intake-coordinator";
import { streamCompositeAnalyze } from "./stream-composite";

import type { AssistantMessageBlock } from "@fambrain/brain-types";

type AnalystStreamChunk =
    | { type: "thinking"; text: string }
    | { type: "assistant"; text: string }
    | { type: "ui_block"; block: AssistantMessageBlock };

const useCompositeParallelAnalyze = (
    input: InformationAnalystInput
): input is InformationAnalystInput & {
    compositeSubResults: NonNullable<
        InformationAnalystInput["compositeSubResults"]
    >;
} =>
    input.routeMode === "composite" &&
    (input.compositeSubResults?.length ?? 0) >= 2;

const resolveSingleSlotCachedAnswer = (
    input: InformationAnalystInput
): InformationAnalystResult | null => {
    const plan = input.compositeIncrementalPlan;
    if (!plan || plan.slots.length !== 1) return null;
    const slot = plan.slots[0]!;
    if (!slot.useCachedAnswer || !slot.cachedAnswer) return null;
    return cachedFacetToAnalystResult(slot.cachedAnswer);
};

/** 单问 plain-text 流式（与 composite 子问同路径，避免 JSON 解析失败 → excerpt 体） */
async function* streamSinglePlainAnalyze(
    input: InformationAnalystInput,
    profile: ReturnType<typeof resolveAnalystQueryProfile>
): AsyncGenerator<AnalystStreamChunk, InformationAnalystResult> {
    const limit = maxAnalystHitsForProfile(profile);
    const hits = input.hits.slice(0, limit);
    const subInput = toSubQuestionInput(input, profile, hits);
    const gen = streamAnalyzeSubQuestion(subInput);
    let result: InformationAnalystResult | undefined;
    while (true) {
        const next = await gen.next();
        if (next.done) {
            result = next.value;
            break;
        }
        yield { type: "assistant", text: next.value.text };
    }
    logAgentOut("InformationAnalyst", "出去", {
        source: "plain_text_stream",
        queryType: profile,
        insufficientEvidence: result!.insufficientEvidence,
        confidence: result!.confidence,
        citationCount: result!.citations.length,
        answerPreview:
            result!.answer.length > 400
                ? `${result!.answer.slice(0, 400)}…`
                : result!.answer,
    });
    return result!;
}

/** 单问 / 单槽：流式 Analyst（tech 等仍走 JSON） */
async function* streamSingleAnalyze(
    input: InformationAnalystInput
): AsyncGenerator<AnalystStreamChunk, InformationAnalystResult> {
    if (input.routeMode === "dag" && input.toolResults?.synthesis?.answer) {
        input = {
            ...input,
            notes: [input.notes, input.toolResults.synthesis.answer]
                .filter(Boolean)
                .join("\n\n"),
        };
    }
    const l3Cached = resolveSingleSlotCachedAnswer(input);
    if (l3Cached) {
        logAgentOut("InformationAnalyst", "出去", {
            source: "facet_cache_l3",
            insufficientEvidence: l3Cached.insufficientEvidence,
            confidence: l3Cached.confidence,
            citationCount: l3Cached.citations.length,
            blockCount: l3Cached.blocks?.length ?? 0,
            answerPreview:
                l3Cached.answer.length > 400
                    ? `${l3Cached.answer.slice(0, 400)}…`
                    : l3Cached.answer,
        });
        yield { type: "assistant", text: l3Cached.answer };
        for (const block of l3Cached.blocks ?? []) {
            yield { type: "ui_block", block };
        }
        return l3Cached;
    }

    const profile = resolveAnalystQueryProfile({
        userQuestion: input.userQuestion,
        subTasks: input.subTasks,
        queryType: input.queryType,
        searchQuery: input.searchQuery,
    });
    const fallback = buildFallbackAnswer(input);
    const { ollama } = getBrainServiceConfig();

    if (shouldSkipAnalystLlm(input)) {
        logAgentOut("InformationAnalyst", "出去", {
            source: "rules_empty_hits_skip_llm",
            insufficientEvidence: fallback.insufficientEvidence,
            confidence: fallback.confidence,
            citationCount: 0,
            answerPreview:
                fallback.answer.length > 400
                    ? `${fallback.answer.slice(0, 400)}…`
                    : fallback.answer,
        });
        yield { type: "assistant", text: fallback.answer };
        return fallback;
    }

    if (prefersPlainTextAnalystStream(profile)) {
        const result = yield* streamSinglePlainAnalyze(input, profile);
        for (const block of result.blocks ?? []) {
            yield { type: "ui_block", block };
        }
        return result;
    }

    try {
        const messages = [
            { role: "system", content: prompt },
            { role: "user", content: JSON.stringify(input, null, 2) },
        ];
        let fullContent = "";
        const gen = streamOllamaNative({
            messages,
            think: false,
            model: ollama.models.intakeCoordinator,
        });
        while (true) {
            const next = await gen.next();
            if (next.done) {
                const usage = next.value;
                if (usage) {
                    recordPipelineTokenUsage({
                        prompt: usage.promptTokens,
                        completion: usage.completionTokens,
                    }, { node: "analyst" });
                }
                else {
                    recordPipelineTokenUsage(estimateTokenUsage(JSON.stringify(messages), fullContent), {
                        estimated: true,
                        node: "analyst",
                    });
                }
                break;
            }
            const chunk = next.value;
            if (chunk.kind === "thinking") {
                yield { type: "thinking", text: chunk.fullText };
            }
            else {
                fullContent = chunk.fullText;
                yield { type: "assistant", text: chunk.fullText };
            }
        }
        const parsed = parseJsonObject<InformationAnalystResult>(fullContent);
        const result = normalizeAnalystResult(parsed, fallback);
        if (result.answer !== fullContent.trim()) {
            yield { type: "assistant", text: result.answer };
        }
        logAgentOut("InformationAnalyst", "出去", {
            source: parsed ? "llm_json" : "fallback_parse",
            queryType: profile,
            insufficientEvidence: result.insufficientEvidence,
            confidence: result.confidence,
            citationCount: result.citations.length,
            answerPreview:
                result.answer.length > 400
                    ? `${result.answer.slice(0, 400)}…`
                    : result.answer,
        });
        return result;
    } catch (e) {
        logAgentOut("InformationAnalyst", "出去", {
            source: "fallback",
            error: e instanceof Error ? e.message : String(e),
            insufficientEvidence: fallback.insufficientEvidence,
            answerPreview:
                fallback.answer.length > 400
                    ? `${fallback.answer.slice(0, 400)}…`
                    : fallback.answer,
        });
        yield { type: "assistant", text: fallback.answer };
        return fallback;
    }
}

/**
 * 信息分析师流式入口：
 * - composite ≥2 子问 → 并行分问 Analyst（stream-composite）
 * - 其余 → 单问流式 Analyst
 */
export async function* streamAnalyzeInformation(
    input: InformationAnalystInput
): AsyncGenerator<AnalystStreamChunk, InformationAnalystResult> {
    const profile = resolveAnalystQueryProfile({
        userQuestion: input.userQuestion,
        subTasks: input.subTasks,
        queryType: input.queryType,
        searchQuery: input.searchQuery,
    });

    logAgentIn("InformationAnalyst", "进入", {
        userQuestion: input.userQuestion,
        language: input.language,
        hitCount: input.hits.length,
        coverage: input.coverage,
        notes: input.notes,
        hasMemoryBlock: Boolean(input.memoryBlock),
        subTasks: input.subTasks,
        queryType: input.queryType ?? profile,
        routeMode: input.routeMode ?? "single",
        compositeSlotCount: input.compositeSubResults?.length ?? 0,
        hitPaths: input.hits.map((h) => h.path),
        analyzeMode: useCompositeParallelAnalyze(input)
            ? "composite_sequential_stream"
            : prefersPlainTextAnalystStream(profile)
              ? "single_plain_stream"
              : "single_json",
    });

    if (useCompositeParallelAnalyze(input)) {
        return yield* streamCompositeAnalyze(input, input.compositeSubResults);
    }

    return yield* streamSingleAnalyze(input);
}
