import { z } from "zod";
import {
  nonEmptyStringArray,
  nullableTrimmedString,
  unitInterval,
} from "@/agentflow/utils";
import type { IntakeRoutingDecision } from "./prompt";
export const intakeQueryTypeSchema = z.enum([
  "identity",
  "enumeration",
  "tech",
  "external_link",
  "default",
]);
export const intakeIntentSchema = z.enum([
  "retrieve_and_answer",
  "summarize_content",
  "direct_answer",
  "clarify",
  "chitchat",
  "out_of_scope",
  "remember_user_fact",
  "recall_user_fact",
]);
export const intakeLanguageSchema = z
  .enum(["zh", "en", "mixed"])
  .catch("zh" as const);
export const enumerationControlSchema = z
  .object({
    action: z.enum(["preview", "continue", "exhaustive"]),
    listKind: z.enum(["project", "experience"]),
    excludeHint: z
      .union([z.string(), z.null()])
      .optional()
      .transform((v) => (typeof v === "string" ? v.trim() || null : null)),
  })
  .nullable()
  .optional()
  .catch(null);

export const intakeRetrievalPlanItemSchema = z.object({
  label: z.coerce.string().transform((s) => String(s).trim()),
  searchQuery: z.coerce.string().transform((s) => String(s).trim()),
  queryType: intakeQueryTypeSchema,
  topics: nonEmptyStringArray.catch([]),
  enumerationControl: enumerationControlSchema,
});
export const intakeRoutingDecisionSchema = z.object({
  intent: intakeIntentSchema,
  searchQuery: z.coerce.string().transform((s) => String(s).trim()),
  subTasks: nonEmptyStringArray.catch([]),
  topics: nonEmptyStringArray.catch([]),
  language: intakeLanguageSchema,
  confidence: unitInterval,
  queryType: intakeQueryTypeSchema.nullable().catch(null),
  clarifyingQuestion: nullableTrimmedString,
  briefReply: nullableTrimmedString,
  retrievalPlan: z.array(intakeRetrievalPlanItemSchema).catch([]),
  userFactKey: z.preprocess(
    (v) => (v === undefined ? null : v),
    nullableTrimmedString
  ),
  userFactLabel: z.preprocess(
    (v) => (v === undefined ? null : v),
    nullableTrimmedString
  ),
  userFactValue: z.preprocess(
    (v) => (v === undefined ? null : v),
    nullableTrimmedString
  ),
});
const pickIntakeField = (
  raw: Record<string, unknown>,
  camel: string,
  snake: string
): unknown => (camel in raw ? raw[camel] : raw[snake]);

const normalizePlanItem = (
  item: Record<string, unknown>
): Record<string, unknown> => {
  const control = pickIntakeField(
    item,
    "enumerationControl",
    "enumeration_control"
  );
  return {
    ...item,
    searchQuery: pickIntakeField(item, "searchQuery", "search_query"),
    queryType: pickIntakeField(item, "queryType", "query_type"),
    enumerationControl: control,
  };
};

const normalizeIntakeRaw = (
  raw: Record<string, unknown>
): Record<string, unknown> => {
  const planRaw = pickIntakeField(raw, "retrievalPlan", "retrieval_plan");
  const retrievalPlan = Array.isArray(planRaw)
    ? planRaw.map((item) =>
        item && typeof item === "object" && !Array.isArray(item)
          ? normalizePlanItem(item as Record<string, unknown>)
          : item
      )
    : planRaw;
  return {
    ...raw,
    searchQuery: pickIntakeField(raw, "searchQuery", "search_query"),
    subTasks: pickIntakeField(raw, "subTasks", "sub_tasks"),
    queryType: pickIntakeField(raw, "queryType", "query_type"),
    clarifyingQuestion: pickIntakeField(
      raw,
      "clarifyingQuestion",
      "clarifying_question"
    ),
    briefReply: pickIntakeField(raw, "briefReply", "brief_reply"),
    retrievalPlan,
    userFactKey: pickIntakeField(raw, "userFactKey", "user_fact_key"),
    userFactLabel: pickIntakeField(raw, "userFactLabel", "user_fact_label"),
    userFactValue: pickIntakeField(raw, "userFactValue", "user_fact_value"),
  };
};

export const parseIntakeRoutingDecision = (
  raw: unknown
): IntakeRoutingDecision | null => {
  const normalized =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? normalizeIntakeRaw(raw as Record<string, unknown>)
      : raw;
  const parsed = intakeRoutingDecisionSchema.safeParse(normalized);
  return parsed.success ? parsed.data : null;
};
