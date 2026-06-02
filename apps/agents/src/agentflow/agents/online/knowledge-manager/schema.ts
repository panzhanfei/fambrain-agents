import { z } from "zod";

import { nullableTrimmedString, unitInterval } from "@/agentflow/zod-utils";

import type { KnowledgeHit, KnowledgeRetrievalResult } from "./prompt";

export const knowledgeHitSchema = z.object({
  path: z.string().trim().min(1),
  title: z.coerce.string().transform((s) => String(s).trim()),
  excerpt: z.string().trim().min(1),
  relevance: unitInterval,
});

export const knowledgeHitsSchema = z.array(knowledgeHitSchema).max(5);

export const knowledgeCoverageSchema = z.enum([
  "sufficient",
  "partial",
  "none",
]);

export const knowledgeRetrievalResultSchema = z.object({
  hits: knowledgeHitsSchema,
  coverage: knowledgeCoverageSchema,
  notes: nullableTrimmedString,
});

export function parseKnowledgeHits(raw: unknown): KnowledgeHit[] {
  const parsed = knowledgeHitsSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((h): h is Record<string, unknown> => !!h && typeof h === "object")
    .map((h) => ({
      path: String(h.path ?? "").trim(),
      title: String(h.title ?? "").trim(),
      excerpt: String(h.excerpt ?? "").trim(),
      relevance: Math.min(1, Math.max(0, Number(h.relevance) || 0)),
    }))
    .filter((h) => h.path && h.excerpt)
    .slice(0, 5);
}

/** 校验并规范化知识管理员模型输出的 JSON */
export function parseKnowledgeRetrievalResult(
  raw: unknown,
  fallback: KnowledgeRetrievalResult
): KnowledgeRetrievalResult {
  const parsed = knowledgeRetrievalResultSchema.safeParse(raw);
  if (parsed.success) {
    return {
      hits: parsed.data.hits,
      coverage: parsed.data.coverage,
      notes: parsed.data.notes,
    };
  }

  if (!raw || typeof raw !== "object") return fallback;
  const o = raw as Record<string, unknown>;
  const hits = parseKnowledgeHits(o.hits);
  if (hits.length === 0) return fallback;

  const coverageParsed = knowledgeCoverageSchema.safeParse(o.coverage);
  const notesParsed = nullableTrimmedString.safeParse(o.notes);

  return {
    hits,
    coverage: coverageParsed.success ? coverageParsed.data : fallback.coverage,
    notes: notesParsed.success ? notesParsed.data : fallback.notes,
  };
}
