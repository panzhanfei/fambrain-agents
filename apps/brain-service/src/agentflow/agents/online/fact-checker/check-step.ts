/**
 * Per-step FactChecker：对每个 composite / pathPlan step 独立核查。
 */
import type { CompositeSubRetrieval } from "@/agentflow/agents/online/knowledge-manager";
import type { RoutedIntakeDecision } from "@/agentflow/agents/online/intake-coordinator";
import type { StepFactCheck, StepResult } from "@/agentflow/agents/online/intake-coordinator/path-plan";
import { completeFactCheck } from "./check-facts";
import { buildRuleBasedFactCheck } from "./check-helpers";
import type { FactCheckerResult } from "./prompt";

export type CheckStepInput = {
    userQuestion: string;
    decision: RoutedIntakeDecision;
    sub: CompositeSubRetrieval;
    retryCount: number;
    retrievalCacheHit: boolean;
};

const toStepFc = (result: FactCheckerResult): StepFactCheck => ({
    passed: result.passed,
    refinedSearchQuery: result.refinedSearchQuery,
    issues: result.issues,
    checkerNotes: result.checkerNotes,
});

export const checkStepFacts = async (
    input: CheckStepInput
): Promise<StepFactCheck> => {
    const { sub, decision, userQuestion, retryCount, retrievalCacheHit } =
        input;

    const isList =
        Boolean(sub.enumerationMeta) ||
        String(sub.facetKey ?? "").startsWith("list:");

    if (isList) {
        const passed =
            (sub.hits.length > 0 && sub.coverage !== "none") || retryCount > 0;
        return {
            passed,
            refinedSearchQuery: null,
            issues: [],
            checkerNotes: passed ? null : "列举结果不足",
        };
    }

    if (sub.hits.length === 0 || sub.coverage === "none") {
        const rule = buildRuleBasedFactCheck({
            userQuestion,
            intent: decision.intent,
            searchQuery: decision.searchQuery || userQuestion,
            subTasks: [sub.label],
            topics: decision.topics,
            language: decision.language,
            hits: sub.hits,
            coverage: sub.coverage,
            notes: sub.notes,
            retryCount,
            confidenceTier: sub.confidenceTier ?? null,
            retrievalCacheHit: false,
            queryType: decision.queryType,
        });
        return toStepFc(rule);
    }

    const slot = decision.compositeSlots.find(
        (s) => String(s.id) === String(sub.slot)
    );
    const result = await completeFactCheck({
        userQuestion,
        intent: decision.intent,
        searchQuery: slot?.searchQuery || decision.searchQuery || userQuestion,
        subTasks: [sub.label],
        topics: slot?.topics ?? decision.topics,
        language: decision.language,
        hits: sub.hits,
        coverage: sub.coverage,
        notes: sub.notes,
        retryCount,
        confidenceTier: sub.confidenceTier ?? null,
        retrievalCacheHit,
        queryType: slot?.queryType ?? decision.queryType,
    });
    return toStepFc(result);
};

export const subToStepResult = (
    sub: CompositeSubRetrieval,
    fc: StepFactCheck,
    pathKind: StepResult["pathKind"] = "km"
): StepResult => ({
    stepId: String(sub.slot),
    pathKind: sub.enumerationMeta || String(sub.facetKey ?? "").startsWith("list:")
        ? "list"
        : pathKind,
    label: sub.label,
    hits: sub.hits,
    coverage: sub.coverage,
    notes: sub.notes,
    confidenceTier: sub.confidenceTier ?? null,
    enumerationMeta: sub.enumerationMeta ?? null,
    cacheHit: sub.cacheHit,
    facetKey: sub.facetKey,
    fc,
});

/**
 * 对全部 subResults 并行 FC；失败段标记 insufficient，不阻断其它段。
 * 若仅 1 个 step 失败且可 refined，返回需局部重试的 decision patch。
 */
export const runPerStepFactChecks = async (input: {
    userQuestion: string;
    decision: RoutedIntakeDecision;
    compositeSubResults: CompositeSubRetrieval[];
    retryCount: number;
    retrievalCacheHit: boolean;
}): Promise<{
    stepResults: StepResult[];
    checkerPassed: boolean;
    notes: string | null;
    refinedDecision: RoutedIntakeDecision | null;
}> => {
    const subs = input.compositeSubResults;
    if (subs.length === 0) {
        return {
            stepResults: [],
            checkerPassed: true,
            notes: null,
            refinedDecision: null,
        };
    }

    const fcs = await Promise.all(
        subs.map((sub) =>
            checkStepFacts({
                userQuestion: input.userQuestion,
                decision: input.decision,
                sub,
                retryCount: input.retryCount,
                retrievalCacheHit: input.retrievalCacheHit,
            })
        )
    );

    const stepResults = subs.map((sub, i) =>
        subToStepResult(sub, fcs[i]!)
    );

    const notes = fcs
        .map((f) => f.checkerNotes)
        .filter((n): n is string => Boolean(n?.trim()))
        .join(" ");

    // 单槽失败且可改写 → 局部重试；多槽失败 → 放行并让 Analyst 写「证据不足」
    let refinedDecision: RoutedIntakeDecision | null = null;
    if (
        subs.length === 1 &&
        !fcs[0]!.passed &&
        fcs[0]!.refinedSearchQuery &&
        input.retryCount < 1
    ) {
        const refined = fcs[0]!.refinedSearchQuery!;
        const primary = input.decision.compositeSlots[0];
        refinedDecision = {
            ...input.decision,
            searchQuery: refined,
            compositeSlots:
                primary != null
                    ? [{ ...primary, searchQuery: refined }]
                    : input.decision.compositeSlots,
            pathPlan: {
                ...input.decision.pathPlan,
                km: input.decision.pathPlan.km.map((s, i) =>
                    i === 0 ? { ...s, searchQuery: refined } : s
                ),
            },
        };
    }

    // 多槽：不因单段失败打回整轮；checkerPassed=true 继续 compose
    const checkerPassed =
        refinedDecision != null
            ? false
            : subs.length >= 2
              ? true
              : (fcs[0]?.passed ?? true);

    return {
        stepResults,
        checkerPassed,
        notes: notes || null,
        refinedDecision,
    };
};
