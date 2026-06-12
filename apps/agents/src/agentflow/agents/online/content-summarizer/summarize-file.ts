import { readFile } from "node:fs/promises";
import { summarizeContent } from "./summarize";
import type { ContentSummaryResult } from "./prompt";
export const summarizeMarkdownFile = async (absPath: string, options?: {
    language?: "zh" | "en" | "mixed";
    maxBullets?: number;
}): Promise<ContentSummaryResult> => {
    const text = await readFile(absPath, "utf8");
    return summarizeContent({
        text,
        sourceLabel: absPath,
        language: options?.language,
        maxBullets: options?.maxBullets,
    });
};
