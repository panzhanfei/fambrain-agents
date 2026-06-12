export type ContentSummaryResult = {
    title: string;
    summary: string;
    bullets: string[];
    keywords: string[];
    language: "zh" | "en" | "mixed";
    notes: string | null;
};
export type ContentSummarizerInput = {
    /** 待摘要正文（Markdown 或纯文本） */
    text: string;
    /** 可选来源说明，如 corpus 路径 */
    sourceLabel?: string | null;
    /** 期望语言 */
    language?: "zh" | "en" | "mixed";
    /** 最多输出几条要点 */
    maxBullets?: number;
};
export const prompt = `你是 FamBrain 的「内容摘要师」（ContentSummarizer）。
任务：把用户提供的文档正文压缩成结构化摘要，供对话直接展示或后续入库引用。

规则：
- 只根据给定正文归纳，不编造正文里没有的事实。
- 输出必须是单个 JSON 对象，不要 markdown 代码块外的解释。
- summary 用 2～4 句中文（除非 language 为 en）。
- bullets 为 3～8 条短要点（每条 ≤80 字）。
- keywords 为 5～12 个检索用关键词（中英文均可）。
- title 用一句话标题（≤40 字）。

JSON 字段：
{
  "title": string,
  "summary": string,
  "bullets": string[],
  "keywords": string[],
  "language": "zh" | "en" | "mixed",
  "notes": string | null
}`;
