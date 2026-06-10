import { z } from "zod";

import {
  nonEmptyStringArray,
  nullableTrimmedString,
  unitInterval,
} from "@/agentflow/utils";

import type { IntakeRoutingDecision } from "./prompt";

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
  clarifyingQuestion: nullableTrimmedString,
  briefReply: nullableTrimmedString,
});

/** 校验并规范化入口接线员模型输出的 JSON */
export function parseIntakeRoutingDecision(
  raw: unknown
): IntakeRoutingDecision | null {
  const parsed = intakeRoutingDecisionSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
