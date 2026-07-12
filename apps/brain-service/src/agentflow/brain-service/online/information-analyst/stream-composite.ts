import {
    analystResultToCachedFacet,
    cachedFacetToAnalystResult,
    resolveQueryProfile,
    type CompositeSlotPlan,
} from "@/agentflow/brain-service/online/knowledge-manager";
import { organizeKnowledge } from "@/agentflow/brain-service/online/content-organizer";
import { logAgentIn, logAgentOut } from "@fambrain/brain-shared/agent-log";
import type { AssistantMessageBlock } from "@fambrain/brain-types";
import { upsertFacetAnswers } from "@fambrain/infra";
import {
    mergeSubQuestionAnswers,
    type SubQuestionAnalyzeInput,
} from "./analyze-helpers";
import { mergeCompositeWithBlocks } from "./compose-message";
import { streamAnalyzeSubQuestion } from "./complete-analyze";
import type { InformationAnalystInput, InformationAnalystResult } from "./prompt";

type AnalystStreamChunk =
    | { type: "thinking"; text: string }
    | { type: "assistant"; text: string }
    | { type: "ui_block"; block: AssistantMessageBlock };

type SubQuestionDone = {
    order: number;
    label: string;
    facetKey: string;
    result: InformationAnalystResult;
    fromFacetCache: boolean;
};

const buildSubInput = (
    input: InformationAnalystInput,
    plan: CompositeSlotPlan,
    sub: NonNullable<InformationAnalystInput["compositeSubResults"]>[number]
): SubQuestionAnalyzeInput => {
    const queryType = resolveQueryProfile(
        plan.searchQuery,
        plan.subTasks,
        plan.queryType
    );
    const organized = organizeKnowledge({
        hits: sub.hits,
        coverage: sub.coverage,
        notes: sub.notes ?? null,
        queryProfile: queryType,
    });
    return {
        userQuestion: plan.label,
        language: input.language,
        hits: organized.hits,
        coverage: sub.coverage,
        notes: sub.notes ?? null,
        queryType,
        topics: [...plan.topics],
        enumerationMeta: sub.enumerationMeta ?? null,
        listIntent: input.listIntent ?? null,
        asOfDate: input.asOfDate ?? new Date().toISOString().slice(0, 10),
        slotId: plan.id,
        toolResults: input.toolResults,
    };
};

const findSubResult = (
    input: InformationAnalystInput,
    plan: CompositeSlotPlan,
    order: number
) => input.compositeSubResults?.[order];

const emitSectionBlocks = function* (
    sectionNo: number,
    label: string,
    result: InformationAnalystResult
): Generator<AnalystStreamChunk> {
    if (result.blocks?.length) {
        yield { type: "ui_block", block: { type: "heading", text: label, sectionNo } };
        for (const block of result.blocks) {
            yield { type: "ui_block", block };
        }
        return;
    }
    yield {
        type: "assistant",
        text: `${sectionNo}. ${label}\n${result.answer.trim()}`,
    };
};

/**
 * composite：槽答案缓存命中 instant 展示 + 新 facet 顺序流式；列举槽 deterministic + ui_block。
 */
export async function* streamCompositeAnalyze(
    input: InformationAnalystInput,
    subs: NonNullable<InformationAnalystInput["compositeSubResults"]>
): AsyncGenerator<AnalystStreamChunk, InformationAnalystResult> {
    const plans = input.compositeIncrementalPlan?.slots ?? [];
    const sessionKey = input.sessionKey;

    logAgentIn("InformationAnalyst", "composite 增量流式进入", {
        userQuestion: input.userQuestion,
        subCount: subs.length,
        facetCacheHits: input.compositeIncrementalPlan?.facetCacheHits ?? 0,
        labels: subs.map((s) => s.label),
    });

    if (plans.length === 0) {
        throw new Error("composite 缺少 incremental plan");
    }

    const completed: SubQuestionDone[] = [];

    for (let order = 0; order < plans.length; order++) {
        const plan = plans[order]!;
        const sub = findSubResult(input, plan, order) ?? subs[order];
        if (!sub) continue;

        const sectionNo = order + 1;
        const prefix =
            completed.length > 0
                ? `${mergeSubQuestionAnswers(
                      completed.map((s) => ({
                          order: s.order,
                          label: s.label,
                          result: s.result,
                      }))
                  ).answer}\n\n`
                : "";

        if (plan.useCachedAnswer && plan.cachedAnswer) {
            const result = cachedFacetToAnalystResult(plan.cachedAnswer);
            completed.push({
                order,
                label: plan.label,
                facetKey: plan.facetKey,
                result,
                fromFacetCache: true,
            });
            yield {
                type: "assistant",
                text: mergeCompositeWithBlocks(
                    completed.map((s) => ({
                        order: s.order,
                        label: s.label,
                        result: s.result,
                    }))
                ).answer,
            };
            yield {
                type: "ui_block",
                block: { type: "heading", text: plan.label, sectionNo },
            };
            for (const block of result.blocks ?? []) {
                yield { type: "ui_block", block };
            }
            continue;
        }

        yield {
            type: "thinking",
            text: `正在回答第 ${sectionNo}/${plans.length} 项：${plan.label}…`,
        };

        const subInput = buildSubInput(input, plan, sub);
        const gen = streamAnalyzeSubQuestion(subInput);
        let result: InformationAnalystResult | undefined;

        let next = await gen.next();
        while (!next.done) {
            yield {
                type: "assistant",
                text: `${prefix}${sectionNo}. ${plan.label}\n${next.value.text}`,
            };
            next = await gen.next();
        }
        result = next.value;

        completed.push({
            order,
            label: plan.label,
            facetKey: plan.facetKey,
            result,
            fromFacetCache: false,
        });

        yield {
            type: "assistant",
            text: mergeCompositeWithBlocks(
                completed.map((s) => ({
                    order: s.order,
                    label: s.label,
                    result: s.result,
                }))
            ).answer,
        };
        yield* emitSectionBlocks(sectionNo, plan.label, result);
    }

    const merged = mergeCompositeWithBlocks(
        completed.map((s) => ({
            order: s.order,
            label: s.label,
            result: s.result,
        }))
    );

    if (sessionKey) {
        await upsertFacetAnswers(sessionKey, {
            facets: completed.map((s) =>
                analystResultToCachedFacet(
                    s.facetKey,
                    s.label,
                    s.result,
                    s.fromFacetCache
                        ? (plans[s.order]?.cachedAnswer?.coverage ?? "partial")
                        : (subs[s.order]?.coverage ?? "partial")
                )
            ),
            userQuestion: input.userQuestion,
            fullAnswer: merged.answer,
            facetKeys: completed.map((s) => s.facetKey),
        }).catch(() => undefined);
    }

    logAgentOut("InformationAnalyst", "composite 增量流式出去", {
        subCount: subs.length,
        facetCacheHits: completed.filter((s) => s.fromFacetCache).length,
        blockCount: merged.blocks?.length ?? 0,
        citationCount: merged.citations.length,
        answerPreview:
            merged.answer.length > 400
                ? `${merged.answer.slice(0, 400)}…`
                : merged.answer,
    });

    return merged;
};
