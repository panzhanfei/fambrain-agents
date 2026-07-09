import { dedupeCitations } from "@/agentflow/brain-service/online/content-organizer";
import type {
  KnowledgeHit,
  KnowledgeRetrievalResult,
} from "@/agentflow/brain-service/online/knowledge-manager";
import type { QueryProfile } from "@/agentflow/brain-service/online/knowledge-manager";
import {
  resolveAnalystQueryProfile,
} from "./analyst-recall-limits";
import { isProjectEnumeration } from "@/agentflow/brain-service/online/intake-coordinator";
import { memoryBlockHasStructuredUserFacts } from "@/agentflow/brain-service/online/user-fact";
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
  /** Intake / 槽位 queryType，驱动 prompt 与 fallback 形态 */
  queryType?: QueryProfile;
  /** 槽位 topics（区分项目列举 vs 公司列举） */
  topics?: string[];
};

const hitDisplayTitle = (hit: KnowledgeHit): string => {
  const title = hit.title?.trim();
  if (title) return title;
  const base = hit.path.split("/").pop() ?? hit.path;
  return base.replace(/\.md$/i, "");
};

/** 从 excerpt 取首条实质行，避免 fallback 整段粘贴 Markdown 表格 */
const compactExcerptLine = (excerpt: string, max = 180): string => {
  for (const line of excerpt.split("\n")) {
    const t = line.replace(/\|/g, " ").replace(/\s+/g, " ").trim();
    if (t.length >= 6 && !/^[-#|*\s]+$/.test(t)) {
      return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
    }
  }
  const flat = excerpt.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
};

export const formatHitsAsAnswerList = (
  hits: KnowledgeHit[],
  language: "zh" | "en" | "mixed"
): string =>
  hits
    .map((h) => {
      const title = hitDisplayTitle(h);
      const detail = compactExcerptLine(h.excerpt);
      return language === "en"
        ? `- **${title}**: ${detail}`
        : `- **${title}**：${detail}`;
    })
    .join("\n");

export const shouldSkipSubQuestionLlm = (
  input: SubQuestionAnalyzeInput
): boolean => input.hits.length === 0 || input.coverage === "none";

/** P0-12：FC 二次放行后 hits 仍空时跳过 Analyst LLM；Mem0 有结构化 user_fact 时不 skip */
export const shouldSkipAnalystLlm = (input: InformationAnalystInput): boolean => {
    if (input.hits.length > 0 && input.coverage !== "none") return false;
    if (memoryBlockHasStructuredUserFacts(input.memoryBlock)) return false;
    return input.hits.length === 0 || input.coverage === "none";
};

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

const buildEmptyHitsFallback = (
  input: Pick<
    InformationAnalystInput,
    "userQuestion" | "language" | "subTasks" | "queryType"
  >
): InformationAnalystResult => {
  const { userQuestion, language, subTasks, queryType } = input;
  const profile = resolveAnalystQueryProfile({
    userQuestion,
    subTasks,
    queryType,
  });
  const context = [...subTasks, userQuestion].join(" ");

  if (profile === "identity" && /年龄|出生|多大|几岁|周岁/.test(context)) {
    return {
      answer:
        language === "en"
          ? "Your knowledge base resume does not record a current age or birth date, so I cannot answer how old you are this year."
          : "个人知识库中的简历未标注当前年龄或出生日期，无法据此回答「今年多大」。",
      citations: [],
      confidence: 0.9,
      insufficientEvidence: true,
    };
  }
  if (profile === "identity" && /姓名|叫什么|名字|我叫什么|我是谁/.test(context)) {
    return {
      answer:
        language === "en"
          ? "No name was found in your personal knowledge base resume."
          : "个人知识库中未检索到姓名相关简历内容。",
      citations: [],
      confidence: 0.9,
      insufficientEvidence: true,
    };
  }

  const answer =
    language === "en"
      ? "No relevant content was found in the personal knowledge base for your question. Try naming a specific company or project, or add the matching doc under src/doc first."
      : "当前个人知识库中没有检索到与你问题直接相关的内容。你可以补充具体公司、项目名称，或先在 src/doc/users/<语料归属账号>/corpus 下完善对应文档后再问。";
  return {
    answer,
    citations: [],
    confidence: 0.9,
    insufficientEvidence: true,
  };
};

export const buildSubQuestionFallbackAnswer = (
  input: SubQuestionAnalyzeInput
): InformationAnalystResult => {
  const { userQuestion, hits, coverage, language, queryType } = input;
  if (hits.length === 0 || coverage === "none") {
    const empty = buildEmptyHitsFallback({
      userQuestion,
      language,
      subTasks: [userQuestion],
      queryType,
    });
    return {
      ...empty,
      answer:
        language === "en"
          ? `No knowledge base content for: ${userQuestion}`
          : `知识库未覆盖：${userQuestion}`,
    };
  }

  const profile =
    queryType ??
    resolveAnalystQueryProfile({ userQuestion, subTasks: [userQuestion] });
  let hitsForAnswer = hits;
  if (
    profile === "enumeration" &&
    isProjectEnumeration({
      label: userQuestion,
      searchQuery: userQuestion,
      topics: input.topics ?? [],
    })
  ) {
    const projectHits = hits.filter((h) =>
      h.path.replace(/\\/g, "/").toLowerCase().includes("/projects/")
    );
    if (projectHits.length > 0) hitsForAnswer = projectHits;
  }
  const citations: Citation[] = dedupeCitations(
    hitsForAnswer.map((h) => ({ path: h.path, excerpt: h.excerpt }))
  );

  const answer =
    profile === "enumeration"
      ? formatHitsAsAnswerList(hitsForAnswer, language)
      : hitsForAnswer.length === 1
        ? language === "en"
          ? `${hitDisplayTitle(hitsForAnswer[0]!)}: ${compactExcerptLine(hitsForAnswer[0]!.excerpt)}`
          : `${hitDisplayTitle(hitsForAnswer[0]!)}：${compactExcerptLine(hitsForAnswer[0]!.excerpt)}`
        : formatHitsAsAnswerList(hitsForAnswer, language);

  return {
    answer,
    citations,
    confidence: coverage === "sufficient" ? 0.75 : 0.6,
    insufficientEvidence: false,
  };
};

export const buildFallbackAnswer = (
  input: InformationAnalystInput
): InformationAnalystResult => {
  const { userQuestion, hits, coverage, notes, language, queryType, subTasks } =
    input;
  if (hits.length === 0 || coverage === "none") {
    return buildEmptyHitsFallback({
      userQuestion,
      language,
      subTasks,
      queryType,
    });
  }

  const profile = resolveAnalystQueryProfile({
    userQuestion,
    subTasks,
    queryType,
  });
  const citations: Citation[] = dedupeCitations(
    hits.map((h) => ({
      path: h.path,
      excerpt: h.excerpt,
    }))
  );

  let answer =
    profile === "enumeration"
      ? formatHitsAsAnswerList(hits, language)
      : formatHitsAsAnswerList(hits, language);

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

/** 将单问输入映射为子问流式输入（共享纯文本 Analyst 路径） */
export const toSubQuestionInput = (
  input: InformationAnalystInput,
  profile: QueryProfile,
  hits: KnowledgeHit[]
): SubQuestionAnalyzeInput => ({
  userQuestion: input.userQuestion,
  language: input.language,
  hits,
  coverage: input.coverage,
  notes: input.notes,
  queryType: profile,
  topics: input.topics ?? [],
});
