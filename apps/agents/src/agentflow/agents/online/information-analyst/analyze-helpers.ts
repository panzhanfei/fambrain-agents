import { dedupeCitations } from "@/agentflow/agents/online/content-organizer";
import type {
  KnowledgeHit,
  KnowledgeRetrievalResult,
} from "@/agentflow/agents/online/knowledge-manager";
import type {
  Citation,
  InformationAnalystInput,
  InformationAnalystResult,
} from "./prompt";
import { parseAnalystResult } from "./schema";
export { parseAnalystResult as normalizeAnalystResult };

/** 单个子问题 Analyst 输入（composite map） */
export type SubQuestionAnalyzeInput = {
  userQuestion: string;
  language: "zh" | "en" | "mixed";
  hits: KnowledgeHit[];
  coverage: KnowledgeRetrievalResult["coverage"];
  notes: string | null;
};

export const shouldSkipSubQuestionLlm = (
  input: SubQuestionAnalyzeInput
): boolean => input.hits.length === 0 || input.coverage === "none";

/** P0-12：FC 二次放行后 hits 仍空时跳过 Analyst LLM，避免编造终稿 */
export const shouldSkipAnalystLlm = (input: InformationAnalystInput): boolean =>
  input.hits.length === 0 || input.coverage === "none";

export const formatSubQuestionSection = (
  index: number,
  label: string,
  answer: string
): string => `${index}. ${label}\n${answer.trim()}`;

export const mergeSubQuestionAnswers = (
  sections: Array<{
    order: number;
    label: string;
    result: InformationAnalystResult;
  }>
): InformationAnalystResult => {
  const sorted = [...sections].sort((a, b) => a.order - b.order);
  const answer = sorted
    .map((s, i) => formatSubQuestionSection(i + 1, s.label, s.result.answer))
    .join("\n\n");
  const citations = dedupeCitations(sorted.flatMap((s) => s.result.citations));
  const insufficientEvidence = sorted.every(
    (s) => s.result.insufficientEvidence
  );
  const confidence =
    sorted.length === 0
      ? 0.5
      : sorted.reduce((sum, s) => sum + s.result.confidence, 0) / sorted.length;
  return {
    answer,
    citations,
    confidence,
    insufficientEvidence,
  };
};

export const buildSubQuestionFallbackAnswer = (
  input: SubQuestionAnalyzeInput
): InformationAnalystResult => {
  const { userQuestion, hits, coverage, language } = input;
  if (hits.length === 0 || coverage === "none") {
    const answer =
      language === "en"
        ? `No knowledge base content for: ${userQuestion}`
        : `知识库未覆盖：${userQuestion}`;
    return {
      answer,
      citations: [],
      confidence: 0.85,
      insufficientEvidence: true,
    };
  }
  const top = hits.slice(0, 2);
  const citations: Citation[] = dedupeCitations(
    top.map((h) => ({ path: h.path, excerpt: h.excerpt }))
  );
  const snippet = top
    .map((h) => h.excerpt.replace(/\s+/g, " ").trim().slice(0, 160))
    .join("；");
  const answer =
    language === "en"
      ? `From the knowledge base (${userQuestion}): ${snippet}`
      : `据知识库（${userQuestion}）：${snippet}`;
  return {
    answer,
    citations,
    confidence: coverage === "sufficient" ? 0.7 : 0.55,
    insufficientEvidence: false,
  };
};

export const buildFallbackAnswer = (
  input: InformationAnalystInput
): InformationAnalystResult => {
  const { userQuestion, hits, coverage, notes, language } = input;
  if (hits.length === 0 || coverage === "none") {
    const ageLike = /年龄|多大|几岁|出生|周岁/.test(userQuestion);
    const nameLike = /姓名|叫什么|名字|我叫什么|我是谁/.test(userQuestion);
    let answer: string;
    if (ageLike) {
      answer =
        language === "en"
          ? "Your knowledge base resume does not record a current age or birth date, so I cannot answer how old you are this year."
          : "个人知识库中的简历未标注当前年龄或出生日期，无法据此回答「今年多大」。";
    } else if (nameLike) {
      answer =
        language === "en"
          ? "No name was found in your personal knowledge base resume."
          : "个人知识库中未检索到姓名相关简历内容。";
    } else {
      answer =
        language === "en"
          ? "No relevant content was found in the personal knowledge base for your question. Try naming a specific company or project, or add the matching doc under src/doc first."
          : "当前个人知识库中没有检索到与你问题直接相关的内容。你可以补充具体公司、项目名称，或先在 src/doc/users/<语料归属账号>/corpus 下完善对应文档后再问。";
    }
    return {
      answer,
      citations: [],
      confidence: 0.9,
      insufficientEvidence: true,
    };
  }
  const citations: Citation[] = dedupeCitations(
    hits.map((h) => ({
      path: h.path,
      excerpt: h.excerpt,
    }))
  );
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
};
