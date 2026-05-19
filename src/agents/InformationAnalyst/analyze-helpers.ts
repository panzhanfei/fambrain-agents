import type {
  Citation,
  InformationAnalystInput,
  InformationAnalystResult,
} from "./prompt";

/** 从模型回复文本里抠出 JSON 对象 */
export function parseJsonObject<T>(text: string): T | null {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = (fenced ?? trimmed).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}

/** 无模型或解析失败时：用 hits 拼一段可读回答 */
export function buildFallbackAnswer(
  input: InformationAnalystInput
): InformationAnalystResult {
  const { userQuestion, hits, coverage, notes, language } = input;

  if (hits.length === 0 || coverage === "none") {
    const answer =
      language === "en"
        ? "No relevant content was found in the personal knowledge base for your question. Try naming a specific company or project, or add the matching doc under src/doc first."
        : "当前个人知识库中没有检索到与你问题直接相关的内容。你可以补充具体公司、项目名称，或先在 doc 中完善对应文档后再问。";
    return {
      answer,
      citations: [],
      confidence: 0.9,
      insufficientEvidence: true,
    };
  }

  const citations: Citation[] = hits.map((h) => ({
    path: h.path,
    excerpt: h.excerpt,
  }));

  const bullets = hits.map((h) => `- **${h.title}**：${h.excerpt}`);
  let answer =
    language === "en"
      ? `Regarding "${userQuestion}", from the knowledge base:\n\n${bullets.join("\n")}`
      : `关于「${userQuestion}」，根据知识库摘录：\n\n${bullets.join("\n")}`;

  if (coverage === "partial") {
    answer +=
      language === "en"
        ? "\n\n(Some details may be missing from the retrieved excerpts.)"
        : "\n\n（部分细节可能未在检索片段中覆盖。）";
  }
  if (notes) {
    answer += language === "en" ? `\n\nNote: ${notes}` : `\n\n备注：${notes}`;
  }

  return {
    answer,
    citations,
    confidence: coverage === "sufficient" ? 0.75 : 0.6,
    insufficientEvidence: false,
  };
}

/** 校验并规范化模型输出的 JSON */
export function normalizeAnalystResult(
  raw: unknown,
  fallback: InformationAnalystResult
): InformationAnalystResult {
  if (!raw || typeof raw !== "object") return fallback;
  const o = raw as Record<string, unknown>;

  const answer = String(o.answer ?? "").trim();
  if (!answer) return fallback;

  const citations: Citation[] = Array.isArray(o.citations)
    ? o.citations
        .filter((c): c is Record<string, unknown> => !!c && typeof c === "object")
        .map((c) => ({
          path: String(c.path ?? ""),
          excerpt: String(c.excerpt ?? ""),
        }))
        .filter((c) => c.path && c.excerpt)
    : fallback.citations;

  const confidence = Math.min(1, Math.max(0, Number(o.confidence) || 0));
  const insufficientEvidence =
    typeof o.insufficientEvidence === "boolean"
      ? o.insufficientEvidence
      : fallback.insufficientEvidence;

  return { answer, citations, confidence, insufficientEvidence };
}
