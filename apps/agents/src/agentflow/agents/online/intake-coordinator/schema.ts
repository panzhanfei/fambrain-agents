import { z } from "zod";
import { nonEmptyStringArray, nullableTrimmedString, unitInterval, } from "@/agentflow/utils";
import type { IntakeRoutingDecision } from "./prompt";
export const intakeQueryTypeSchema = z.enum([
    "identity",
    "enumeration",
    "tech",
    "default",
]);
export const intakeIntentSchema = z.enum([
    "retrieve_and_answer",
    "summarize_content",
    "direct_answer",
    "clarify",
    "chitchat",
    "out_of_scope",
]);
export const intakeLanguageSchema = z
    .enum(["zh", "en", "mixed"])
    .catch("zh" as const);
export const intakeRoutingDecisionSchema = z.object({
    intent: intakeIntentSchema,
    needsRetrieval: z.coerce.boolean(),
    searchQuery: z.coerce.string().transform((s) => String(s).trim()),
    subTasks: nonEmptyStringArray.catch([]),
    topics: nonEmptyStringArray.catch([]),
    language: intakeLanguageSchema,
    confidence: unitInterval,
    queryType: intakeQueryTypeSchema.nullable().catch(null),
    clarifyingQuestion: nullableTrimmedString,
    briefReply: nullableTrimmedString,
});
export const parseIntakeRoutingDecision = (raw: unknown): IntakeRoutingDecision | null => {
    const parsed = intakeRoutingDecisionSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
};
