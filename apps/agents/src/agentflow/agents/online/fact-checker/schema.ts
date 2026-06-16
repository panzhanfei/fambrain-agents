import { z } from "zod";
import { nullableTrimmedString, unitInterval } from "@/agentflow/utils";
import type { FactCheckerResult } from "./prompt";

export const factCheckerIssueCodeSchema = z.enum([
    "no_hits_when_needed",
    "hits_irrelevant",
    "coverage_mismatch",
    "excerpt_too_weak",
    "subtask_uncovered",
    "entity_missing",
]);

export const factCheckerIssueSchema = z.object({
    code: factCheckerIssueCodeSchema,
    message: z.string().trim().min(1),
});

export const factCheckerResultSchema = z.object({
    passed: z.coerce.boolean(),
    evidenceScore: unitInterval,
    refinedSearchQuery: nullableTrimmedString,
    checkerNotes: nullableTrimmedString,
    issues: z.array(factCheckerIssueSchema).catch([]),
});

const enforceRetryCap = (result: FactCheckerResult, retryCount: number): FactCheckerResult => {
    if (retryCount < 1 || result.passed) {
        return result;
    }
    const capped: FactCheckerResult = {
        passed: true,
        evidenceScore: Math.min(result.evidenceScore, 0.35),
        refinedSearchQuery: null,
        checkerNotes: result.checkerNotes ??
            "已重试仍不通过模型标准，强制放行；分析师须声明知识库未覆盖或证据有限。",
        issues: result.issues.length
            ? result.issues
            : [
                {
                    code: "no_hits_when_needed",
                    message: "已达最大重试，不再打回检索。",
                },
            ],
    };
    return capped;
};

export const parseFactCheckerResult = (raw: unknown, fallback: FactCheckerResult, retryCount: number): FactCheckerResult => {
    const parsed = factCheckerResultSchema.safeParse(raw);
    if (!parsed.success) {
        return enforceRetryCap(fallback, retryCount);
    }
    let result: FactCheckerResult = {
        passed: parsed.data.passed,
        evidenceScore: parsed.data.evidenceScore,
        refinedSearchQuery: parsed.data.refinedSearchQuery,
        checkerNotes: parsed.data.checkerNotes,
        issues: parsed.data.issues,
    };
    if (result.passed && result.refinedSearchQuery) {
        result = { ...result, refinedSearchQuery: null };
    }
    return enforceRetryCap(result, retryCount);
};
