import { z } from "zod";
import {
  nonEmptyStringArray,
  nullableTrimmedString,
  unitInterval,
} from "@/agentflow/utils";
import type { IntakeRoutingDecision } from "./prompt";
const INTAKE_QUERY_TYPES = [
  "identity",
  "enumeration",
  "tech",
  "external_link",
  "default",
] as const;

/** 非法 LLM 自造类型 → 合法枚举或 default（避免整份 retrievalPlan 被 .catch([]) 丢光） */
export const intakeQueryTypeSchema = z.preprocess((v) => {
  if (typeof v !== "string") return "default";
  if ((INTAKE_QUERY_TYPES as readonly string[]).includes(v)) return v;
  const lower = v.trim().toLowerCase();
  if (
    lower === "role" ||
    lower === "employment" ||
    lower === "employer" ||
    lower === "company"
  ) {
    return "enumeration";
  }
  if (
    lower === "links" ||
    lower === "link" ||
    lower === "url" ||
    lower === "github"
  ) {
    return "external_link";
  }
  if (lower === "tech_stack" || lower === "stack") return "tech";
  if (
    lower === "timeline" ||
    lower === "history" ||
    lower === "time_duration"
  ) {
    return "identity";
  }
  return "default";
}, z.enum(INTAKE_QUERY_TYPES));
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
/** LLM 偶发别名 → 合法 listKind（schema 合法化，非用户口语词表） */
const normalizeListKind = (v: unknown): "project" | "experience" | null => {
  if (typeof v !== "string") return null;
  const t = v.trim().toLowerCase();
  if (t === "project" || t === "projects") return "project";
  if (
    t === "experience" ||
    t === "employer" ||
    t === "employers" ||
    t === "company" ||
    t === "companies"
  ) {
    return "experience";
  }
  return null;
};

export const enumerationControlSchema = z
  .object({
    action: z.enum(["preview", "continue", "exhaustive"]),
    listKind: z.preprocess(
      normalizeListKind,
      z.enum(["project", "experience"])
    ),
    excludeHint: z
      .union([z.string(), z.null()])
      .optional()
      .transform((v) => (typeof v === "string" ? v.trim() || null : null)),
    timeWindowYears: z
      .union([z.number(), z.null()])
      .optional()
      .transform((v) => {
        if (v == null || typeof v !== "number" || !Number.isFinite(v)) {
          return null;
        }
        const n = Math.floor(v);
        return n > 0 && n <= 50 ? n : null;
      }),
  })
  .nullable()
  .optional()
  .catch(null);

/** LLM 偶发字段名 → 合法 identityField */
const normalizeIdentityField = (
  v: unknown
):
  | "name"
  | "age"
  | "email"
  | "phone"
  | "education"
  | "career"
  | "tenure"
  | null => {
  if (v == null) return null;
  if (typeof v !== "string") return null;
  const t = v.trim();
  const allowed = [
    "name",
    "age",
    "email",
    "phone",
    "education",
    "career",
    "tenure",
  ] as const;
  if ((allowed as readonly string[]).includes(t)) {
    return t as (typeof allowed)[number];
  }
  const lower = t.toLowerCase();
  if (
    lower === "careerduration" ||
    lower === "tenure_years" ||
    lower === "yearsofexperience" ||
    lower === "years_of_experience" ||
    lower === "workyears"
  ) {
    return "tenure";
  }
  return null;
};

export const intakeIdentityFieldSchema = z.preprocess(
  normalizeIdentityField,
  z
    .enum(["name", "age", "email", "phone", "education", "career", "tenure"])
    .nullable()
).optional()
.catch(null);

export const intakeRetrievalPlanItemSchema = z.object({
  label: z.coerce.string().transform((s) => String(s).trim()),
  searchQuery: z.coerce.string().transform((s) => String(s).trim()),
  queryType: intakeQueryTypeSchema,
  topics: nonEmptyStringArray.catch([]),
  enumerationControl: enumerationControlSchema,
  identityField: intakeIdentityFieldSchema,
});
export const intakeRoutingDecisionSchema = z.object({
  intent: intakeIntentSchema,
  searchQuery: z.coerce.string().transform((s) => String(s).trim()),
  subTasks: nonEmptyStringArray.catch([]),
  topics: nonEmptyStringArray.catch([]),
  language: intakeLanguageSchema,
  confidence: unitInterval,
  queryType: z.preprocess((v) => {
    if (v === null || v === undefined) return null;
    if (typeof v !== "string") return null;
    return (INTAKE_QUERY_TYPES as readonly string[]).includes(v) ? v : null;
  }, z.enum(INTAKE_QUERY_TYPES).nullable()).catch(null),
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
    identityField: pickIntakeField(item, "identityField", "identity_field"),
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
