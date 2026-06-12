import type { ContentSummaryResult } from "./prompt";
export const formatSummaryAsAnswer = (result: ContentSummaryResult): string => {
    const lines: string[] = [`## ${result.title}`, "", result.summary];
    if (result.bullets.length > 0) {
        lines.push("", "**要点**");
        for (const b of result.bullets) {
            lines.push(`- ${b}`);
        }
    }
    if (result.keywords.length > 0) {
        lines.push("", `**关键词**：${result.keywords.join("、")}`);
    }
    if (result.notes?.trim()) {
        lines.push("", `_${result.notes.trim()}_`);
    }
    return lines.join("\n");
};
