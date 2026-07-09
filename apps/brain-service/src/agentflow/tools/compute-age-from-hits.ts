import { tool } from "@langchain/core/tools";
import { z } from "zod";
import {
    buildAgeAnswer,
    computeAgeYears,
    extractBirthOrAgeFromHits,
    extractBirthOrAgeFromText,
    type BirthDate,
} from "./lib/compute-age";

const hitSchema = z.object({
    path: z.string(),
    excerpt: z.string(),
});

export {
    buildAgeAnswer,
    computeAgeYears,
    extractBirthOrAgeFromHits,
    extractBirthOrAgeFromText,
    type BirthDate,
};

/** LangChain 封装：与主 pipeline `runOrchestratedSubQuestion` 共用核心逻辑 */
export const computeAgeFromHitsTool = tool(
    async (input) => {
        const hits = input.hits.map((h) => ({
            path: h.path,
            title: h.path.split("/").pop() ?? h.path,
            excerpt: h.excerpt,
            relevance: 1,
        }));
        const extraction = extractBirthOrAgeFromHits(hits);
        const { answer, insufficientEvidence } = buildAgeAnswer({
            extraction,
            language: input.language ?? "zh",
            asOfDate: input.asOfDate,
        });
        return JSON.stringify({
            answer,
            insufficientEvidence,
            birthLabel: extraction.birthLabel ?? null,
            explicitAge: extraction.explicitAge ?? null,
            sourcePath: extraction.sourceHit?.path ?? null,
        });
    },
    {
        name: "compute_age_from_hits",
        description:
            "从 KM hits excerpt 提取出生日期或原文年龄，服务端按 asOfDate 计算周岁。用于 identity 年龄槽；禁止 LLM 自行推算。",
        schema: z.object({
            hits: z
                .array(hitSchema)
                .min(1)
                .describe("KM 检索 hits（path + excerpt）"),
            asOfDate: z
                .string()
                .regex(/^\d{4}-\d{2}-\d{2}$/)
                .optional()
                .describe("计算基准日 YYYY-MM-DD，默认今天"),
            language: z.enum(["zh", "en", "mixed"]).optional(),
        }),
    }
);
