/**
 * 内容摘要师（ContentSummarizer）
 * 对 corpus / 上传文档正文生成结构化摘要（D9 触达，不参与在线聊天编排）。
 */

export { summarizeContent } from "./summarize";
export { summarizeMarkdownFile } from "./summarize-file";
export {
  contentSummaryResultSchema,
  parseContentSummaryResult,
} from "./schema";
export { prompt } from "./prompt";
export type {
  ContentSummarizerInput,
  ContentSummaryResult,
} from "./prompt";
