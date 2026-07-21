/**
 * Intake 指代：进线 normalize → 单字短路；首次 JSON peek 后「未消解 → 拼接再调一次」。
 * 不在调用 LLM 前盲合并；散文不触发指代重试（走 JSON 格式修复）。
 */
import type { DbChatTurn } from "@fambrain/brain-types";
import type { IntakeRoutingDecision } from "@/agentflow/agents/online/intake-coordinator/contract";
import {
  historySupportsContinuation,
  isShortContinuationUtterance,
  lastSubstantiveUserQuestion,
} from "./query-signals";

/** 单码点附和（长度已是 1）；不进检索 */
const ACK_SINGLE = new Set([
  "好",
  "嗯",
  "哦",
  "噢",
  "啊",
  "嘿",
  "哈",
  "行",
  "哟",
  "唉",
  "咦",
  "喔",
]);

/** Unicode 码点数（BMP 汉字/标点为 1） */
export const utteranceCodePointLength = (question: string): number =>
  Array.from(question.trim()).length;

/**
 * 进线轻量规范化：trim + 压掉连续相同码点（呢呢呢？？？→呢？）。
 * 不做 NFKC（避免全角「？」变半角「?」导致与 history 对不上）。
 * 用于省 token / 单字判定；不做语义去重或相似句合并。
 */
export const normalizeIntakeUtterance = (question: string): string => {
  const t = question.trim();
  if (!t) return t;
  const out: string[] = [];
  for (const ch of Array.from(t)) {
    if (out.length > 0 && out[out.length - 1] === ch) continue;
    out.push(ch);
  }
  return out.join("");
};

/**
 * 去掉首尾标点/符号后的实质串，供「是否单字」判定（「呢？？」→「呢」）。
 * 全是标点时返回空串。
 */
export const substantiveUtteranceForSingleChar = (
  normalized: string
): string => {
  const t = normalized.trim();
  if (!t) return "";
  return t.replace(/^[\p{P}\p{S}\s]+|[\p{P}\p{S}\s]+$/gu, "");
};

/** normalize 后再取单字判定用的表面形式 */
export const surfaceForSingleCharSignal = (question: string): string => {
  const normalized = normalizeIntakeUtterance(question);
  const substantive = substantiveUtteranceForSingleChar(normalized);
  if (substantive) return substantive;
  return normalized;
};

export const isSingleCodePointUtterance = (question: string): boolean =>
  utteranceCodePointLength(surfaceForSingleCharSignal(question)) === 1;

export const isAckLikeSingleChar = (question: string): boolean => {
  const t = surfaceForSingleCharSignal(question);
  return utteranceCodePointLength(t) === 1 && ACK_SINGLE.has(t);
};

/**
 * 单字且不应调 Intake LLM（先 normalize 再判）：
 * - 附和（好/嗯/…，含「好好好」「嗯！！！」）
 * - 或无可续上文 / 无上轮实质问
 */
export const shouldShortCircuitIncompleteUtterance = (
  userQuestion: string,
  history: DbChatTurn[]
): boolean => {
  const surface = surfaceForSingleCharSignal(userQuestion);
  if (utteranceCodePointLength(surface) !== 1) return false;
  if (ACK_SINGLE.has(surface)) return true;
  if (!historySupportsContinuation(history)) return true;
  const prior = lastSubstantiveUserQuestion(
    history,
    normalizeIntakeUtterance(userQuestion) || userQuestion
  );
  return !prior;
};

export type CoreferenceMergeRetry = {
  retry: boolean;
  prior: string | null;
  mergedQuestion: string | null;
};

/**
 * 首次 Intake **JSON** 解析后是否拼接再调 LLM（最多 1 次）。
 * 只认 parse 成功的决策；peek=null（散文）不触发。
 * 主信号：coreference=unresolved；
 * 次信号：clarify/userFact/chitchat + 短续问且未标 resolved；
 * 三信号：短续问 retrieve 却 (a) 落到 enumeration，或 (b) plan 未含本轮实体词
 *        → 不发明槽，只强制带 prior 再规划一次。
 */
export const shouldRetryCoreferenceMerge = (
  peek: (Pick<IntakeRoutingDecision, "coreference" | "intent"> &
    Partial<
      Pick<
        IntakeRoutingDecision,
        "queryType" | "searchQuery" | "retrievalPlan" | "pathPlan"
      >
    >) | null,
  userQuestion: string,
  history: DbChatTurn[]
): CoreferenceMergeRetry => {
  const current =
    normalizeIntakeUtterance(userQuestion) || userQuestion.trim();
  const none = {
    retry: false,
    prior: null as string | null,
    mergedQuestion: null as string | null,
  };
  if (!current || !peek) return none;
  if (!historySupportsContinuation(history)) return none;
  const prior = lastSubstantiveUserQuestion(history, current);
  if (!prior || prior === current) {
    return { retry: false, prior, mergedQuestion: null };
  }

  const coref = peek.coreference ?? "none";
  const primary = coref === "unresolved";
  const short =
    isShortContinuationUtterance(current) &&
    utteranceCodePointLength(current) <= 16;
  /** 次信号：JSON 已解析，但短续问被误标成 clarify / userFact / chitchat */
  const misroutedShort =
    short &&
    coref !== "resolved" &&
    (peek.intent === "clarify" ||
      peek.intent === "recall_user_fact" ||
      peek.intent === "remember_user_fact" ||
      peek.intent === "chitchat");
  const pathPlan = peek.pathPlan;
  const planHasEnum =
    (peek.retrievalPlan ?? []).some((p) => p.queryType === "enumeration") ||
    (pathPlan?.list?.length ?? 0) > 0 ||
    (pathPlan?.km ?? []).some((s) => s.queryType === "enumeration");
  /** 短续问主体（去掉句末「呢/吗/标点」）——结构切分，非公司词表 */
  const entityHint = current
    .replace(/[呢嗎吗麽么呀啊吧哇哦噢欸？?！!。.\s]+$/u, "")
    .trim();
  /** 代词续问（那个/这个…）不靠「实体是否在 plan」判定，走 unresolved/主次信号 */
  const deixisOnly = /^(那个|这个|它|上述|刚才|还有|啥|什么)/u.test(entityHint);
  const pathPlanBlob = pathPlan
    ? [
        ...pathPlan.km.flatMap((s) => [s.label, s.searchQuery]),
        ...pathPlan.list.flatMap((s) => [s.label, s.searchQuery]),
        ...pathPlan.tool.flatMap((s) => [s.label, s.searchQuery]),
      ].join(" ")
    : "";
  const planBlob = [
    peek.searchQuery ?? "",
    ...(peek.retrievalPlan ?? []).flatMap((p) => [p.label, p.searchQuery]),
    pathPlanBlob,
  ].join(" ");
  const missingCurrentEntity =
    short &&
    peek.intent === "retrieve_and_answer" &&
    entityHint.length >= 2 &&
    !deixisOnly &&
    !planBlob.includes(entityHint);
  /** 三信号：enumeration 误路由，或实体替换后 plan 仍无本轮实体 */
  const enumOrEntityMiss =
    short &&
    peek.intent === "retrieve_and_answer" &&
    (peek.queryType === "enumeration" || planHasEnum || missingCurrentEntity);

  if (!primary && !misroutedShort && !enumOrEntityMiss) {
    return { retry: false, prior, mergedQuestion: null };
  }

  return {
    retry: true,
    prior,
    mergedQuestion: buildMergedCoreferenceQuestion(prior, current),
  };
};

export const buildMergedCoreferenceQuestion = (
  prior: string,
  current: string
): string => `${prior.trim()}；${current.trim()}`;

/** 改写 history 中最后一条 user，供 LLM 看到合并/规范化问句 */
export const rewriteLastUserTurn = (
  history: DbChatTurn[],
  content: string
): DbChatTurn[] => {
  const out = history.map((t) => ({ ...t }));
  for (let i = out.length - 1; i >= 0; i -= 1) {
    if (out[i]?.role === "user") {
      out[i] = { role: "user", content };
      break;
    }
  }
  return out;
};
