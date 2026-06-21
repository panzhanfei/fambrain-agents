import { getAgentsConfig } from "@fambrain/agent-config";
import { logAgentIn, logAgentOut } from "@fambrain/agent-shared/agent-log";
import { streamOllamaNative } from "@fambrain/agent-shared/ollama-native-stream";
import { parseJsonObject } from "@/agentflow/utils";
import {
    buildFallbackAnswer,
    normalizeAnalystResult,
    shouldSkipAnalystLlm,
} from "./analyze-helpers";
import {
    prompt,
    type InformationAnalystInput,
    type InformationAnalystResult,
} from "./prompt";
import { cachedFacetToAnalystResult } from "@/agentflow/agents/online/intake-coordinator/composite-incremental";
import { streamCompositeAnalyze } from "./stream-composite";

type AnalystStreamChunk =
    | { type: "thinking"; text: string }
    | { type: "assistant"; text: string };

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

/** 单问 / 单槽：流式 Analyst（含 thinking） */
async function* streamSingleAnalyze(
    input: InformationAnalystInput
): AsyncGenerator<AnalystStreamChunk, InformationAnalystResult> {
    const l3Cached = resolveSingleSlotCachedAnswer(input);
    if (l3Cached) {
        logAgentOut("InformationAnalyst", "出去", {
            source: "facet_cache_l3",
            insufficientEvidence: l3Cached.insufficientEvidence,
            confidence: l3Cached.confidence,
            citationCount: l3Cached.citations.length,
            answerPreview:
                l3Cached.answer.length > 400
                    ? `${l3Cached.answer.slice(0, 400)}…`
                    : l3Cached.answer,
        });
        yield { type: "assistant", text: l3Cached.answer };
        return l3Cached;
    }

    const fallback = buildFallbackAnswer(input);
    const { ollama } = getAgentsConfig();

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

    try {
        const messages = [
            { role: "system", content: prompt },
            { role: "user", content: JSON.stringify(input, null, 2) },
        ];
        let fullContent = "";
        for await (const chunk of streamOllamaNative({
            messages,
            think: ollama.streamThink,
            model: ollama.models.intakeCoordinator,
        })) {
            if (chunk.kind === "thinking") {
                yield { type: "thinking", text: chunk.fullText };
            } else {
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
            source: "llm",
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
    logAgentIn("InformationAnalyst", "进入", {
        userQuestion: input.userQuestion,
        language: input.language,
        hitCount: input.hits.length,
        coverage: input.coverage,
        notes: input.notes,
        hasMemoryBlock: Boolean(input.memoryBlock),
        subTasks: input.subTasks,
        routeMode: input.routeMode ?? "single",
        compositeSlotCount: input.compositeSubResults?.length ?? 0,
        hitPaths: input.hits.map((h) => h.path),
        analyzeMode: useCompositeParallelAnalyze(input)
            ? "composite_sequential_stream"
            : "single",
    });

    if (useCompositeParallelAnalyze(input)) {
        return yield* streamCompositeAnalyze(input, input.compositeSubResults);
    }

    return yield* streamSingleAnalyze(input);
}
