/**
 * 纯社交短句检测：问候 / 感谢等无检索意图的 utterance。
 * 用于 Intake 入口短路，避免小模型把「你好」误判为 retrieve_and_answer。
 */

/** 允许少量标点；允许多次重复同一问候（如「你好 你好」） */
const PURE_SOCIAL_RE =
  /^(?:(?:你好|您好|嗨|哈喽|hello|hi|hey|谢谢|感谢|多谢|thanks|thank\s*you)(?:[!.?~，。！？…\s]*))+$/iu;

/** 防 spam；足够覆盖多次短问候，仍挡带实体/问句的长句 */
const MAX_PURE_SOCIAL_LEN = 48;

/** 用户句是否为纯问候/感谢（无并列问句、无实体检索意图） */
export const isPureSocialUtterance = (question: string): boolean => {
  const q = question.trim();
  if (!q || q.length > MAX_PURE_SOCIAL_LEN) return false;
  return PURE_SOCIAL_RE.test(q);
};
