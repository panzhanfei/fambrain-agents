import { z } from "zod";
import { nullableTrimmedString, unitInterval } from "@/agentflow/utils";
import type { KnowledgeHit, KnowledgeRetrievalResult } from "./types";
export const knowledgeHitSchema = z.object({
    path: z.string().trim().min(1),
    title: z.coerce.string().transform((s) => String(s).trim()),
    excerpt: z.string().trim().min(1),
    relevance: unitInterval,
});
export const knowledgeHitsSchema = z.array(knowledgeHitSchema).max(20);

/** profile 感知的 hits 上限（enumeration 8，default 5） */
export const knowledgeHitsSchemaForMax = (maxHits: number) =>
    z.array(knowledgeHitSchema).max(Math.min(maxHits, 20));
export const knowledgeCoverageSchema = z.enum([
    "sufficient",
    "partial",
    "none",
]);
export const knowledgeRetrievalResultSchema = z.object({
    hits: knowledgeHitsSchema,
    coverage: knowledgeCoverageSchema,
    notes: nullableTrimmedString,
    confidenceTier: z.enum(["high", "mid", "low"]).optional(),
    confidenceScore: unitInterval.optional(),
});
export const parseKnowledgeHits = (
    raw: unknown,
    maxHits = 5
): KnowledgeHit[] => {
    const cap = Math.min(Math.max(1, maxHits), 20);
    const parsed = knowledgeHitsSchemaForMax(cap).safeParse(raw);
    if (parsed.success)
        return parsed.data;
    if (!Array.isArray(raw))
        return [];
    return raw
        .filter((h): h is Record<string, unknown> => !!h && typeof h === "object")
        .map((h) => ({
        path: String(h.path ?? "").trim(),
        title: String(h.title ?? "").trim(),
        excerpt: String(h.excerpt ?? "").trim(),
        relevance: Math.min(1, Math.max(0, Number(h.relevance) || 0)),
    }))
        .filter((h) => h.path && h.excerpt)
        .slice(0, cap);
};
export const parseKnowledgeRetrievalResult = (raw: unknown, fallback: KnowledgeRetrievalResult): KnowledgeRetrievalResult => {
    const parsed = knowledgeRetrievalResultSchema.safeParse(raw);
    if (parsed.success) {
        return {
            hits: parsed.data.hits,
            coverage: parsed.data.coverage,
            notes: parsed.data.notes,
            confidenceTier: parsed.data.confidenceTier,
            confidenceScore: parsed.data.confidenceScore,
        };
    }
    if (!raw || typeof raw !== "object")
        return fallback;
    const o = raw as Record<string, unknown>;
    const hits = parseKnowledgeHits(o.hits);
    if (hits.length === 0)
        return fallback;
    const coverageParsed = knowledgeCoverageSchema.safeParse(o.coverage);
    const notesParsed = nullableTrimmedString.safeParse(o.notes);
    return {
        hits,
        coverage: coverageParsed.success ? coverageParsed.data : fallback.coverage,
        notes: notesParsed.success ? notesParsed.data : fallback.notes,
    };
};
