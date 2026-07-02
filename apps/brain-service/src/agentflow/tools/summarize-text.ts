import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { summarizeContent } from "@/agentflow/brain-service/online/content-summarizer/summarize";

export const summarizeTextTool = tool(
    async (input) => {
        const result = await summarizeContent({
            text: input.text,
            sourceLabel: input.sourceLabel ?? "tool:summarize_text",
            language: input.language ?? "zh",
            maxBullets: input.maxBullets ?? 6,
        });
        return JSON.stringify({
            title: result.title,
            summary: result.summary,
            bullets: result.bullets,
            keywords: result.keywords,
            language: result.language,
            notes: result.notes ?? null,
        });
    },
    {
        name: "summarize_text",
        description:
            "对给定正文做结构化摘要（标题、摘要、要点、关键词）。需要 Ollama；不进主 pipeline，供实验或 bindTools 分支使用。",
        schema: z.object({
            text: z.string().min(1).describe("待摘要正文"),
            sourceLabel: z.string().optional().describe("来源标签，便于日志"),
            language: z.enum(["zh", "en", "mixed"]).optional(),
            maxBullets: z.number().int().min(1).max(16).optional(),
        }),
    }
);
