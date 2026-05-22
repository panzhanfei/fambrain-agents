import type { IntakeRoutingDecision } from "../intake-coordinator/prompt";

/** 从接线员回复里解析路由 JSON */
export function parseIntakeDecision(raw: string): IntakeRoutingDecision | null {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = (fenced ?? trimmed).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;

  const o = parsed as Record<string, unknown>;
  const intents = [
    "retrieve_and_answer",
    "direct_answer",
    "clarify",
    "chitchat",
    "out_of_scope",
  ] as const;
  const intent = intents.find((i) => i === o.intent);
  if (!intent) return null;

  const languages = ["zh", "en", "mixed"] as const;
  const language = languages.find((l) => l === o.language) ?? "zh";

  return {
    intent,
    needsRetrieval: Boolean(o.needsRetrieval),
    searchQuery: String(o.searchQuery ?? ""),
    subTasks: Array.isArray(o.subTasks)
      ? o.subTasks.map((t) => String(t))
      : [],
    topics: Array.isArray(o.topics) ? o.topics.map((t) => String(t)) : [],
    language,
    confidence: Math.min(1, Math.max(0, Number(o.confidence) || 0)),
    clarifyingQuestion:
      o.clarifyingQuestion == null
        ? null
        : String(o.clarifyingQuestion).trim() || null,
    briefReply:
      o.briefReply == null ? null : String(o.briefReply).trim() || null,
  };
}

/** 解析失败时的保守默认：按用户原话去检索 */
export function defaultIntakeDecision(
  userQuestion: string
): IntakeRoutingDecision {
  return {
    intent: "retrieve_and_answer",
    needsRetrieval: true,
    searchQuery: userQuestion,
    subTasks: [],
    topics: [],
    language: "zh",
    confidence: 0.4,
    clarifyingQuestion: null,
    briefReply: null,
  };
}
