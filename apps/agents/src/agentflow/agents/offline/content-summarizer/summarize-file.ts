import { readFile } from "node:fs/promises";

import { summarizeContent } from "./summarize";
import type { ContentSummaryResult } from "./prompt";

/** 读取本地 Markdown/文本文件并摘要 */
export async function summarizeMarkdownFile(
  absPath: string,
  options?: { language?: "zh" | "en" | "mixed"; maxBullets?: number }
): Promise<ContentSummaryResult> {
  const text = await readFile(absPath, "utf8");
  return summarizeContent({
    text,
    sourceLabel: absPath,
    language: options?.language,
    maxBullets: options?.maxBullets,
  });
}
