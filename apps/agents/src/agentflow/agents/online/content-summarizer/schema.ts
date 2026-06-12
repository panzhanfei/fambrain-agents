import { z } from "zod";
import { nullableTrimmedString } from "@/agentflow/utils";
import type { ContentSummaryResult } from "./prompt";
export const contentSummaryResultSchema = z.object({
    title: z.string().trim().min(1),
    summary: z.string().trim().min(1),
    bullets: z
        .array(z.coerce.string().transform((s) => s.trim()))
        .transform((items) => items.filter((s) => s.length > 0))
        .catch([]),
    keywords: z
        .array(z.coerce.string().transform((s) => s.trim()))
        .transform((items) => items.filter((s) => s.length > 0))
        .catch([]),
    language: z.enum(["zh", "en", "mixed"]).catch("zh"),
    notes: nullableTrimmedString,
});
export const parseContentSummaryResult = (raw: unknown, fallback: ContentSummaryResult): ContentSummaryResult => {
    const parsed = contentSummaryResultSchema.safeParse(raw);
    if (!parsed.success)
        return fallback;
    return {
        title: parsed.data.title,
        summary: parsed.data.summary,
        bullets: parsed.data.bullets.slice(0, 12),
        keywords: parsed.data.keywords.slice(0, 20),
        language: parsed.data.language,
        notes: parsed.data.notes,
    };
};
