import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { retrieveKnowledge } from "@/agentflow/brain-service/online/knowledge-manager";
import { getToolContext } from "./context";

const queryTypeSchema = z.enum([
    "identity",
    "enumeration",
    "tech",
    "default",
]);

export const retrieveCorpusTool = tool(
    async (input) => {
        const { corpusUserId } = getToolContext();
        const result = await retrieveKnowledge({
            corpusUserId,
            searchQuery: input.searchQuery,
            topics: input.topics ?? [],
            subTasks: input.subTasks ?? [],
            queryType: input.queryType ?? null,
            candidates: [],
        });
        return JSON.stringify({
            hitCount: result.hits.length,
            coverage: result.coverage,
            notes: result.notes,
            confidenceTier: result.confidenceTier ?? null,
            paths: result.hits.slice(0, 8).map((h) => ({
                path: h.path,
                title: h.title,
                relevance: h.relevance,
                excerptPreview: h.excerpt.slice(0, 200),
            })),
        });
    },
    {
        name: "retrieve_corpus",
        description:
            "检索 FamBrain 语料库（向量 + BM25 hybrid，规则精排）。用于履历、项目、技术栈等事实查询；返回 hits 路径与摘录，不生成最终回答。",
        schema: z.object({
            searchQuery: z
                .string()
                .min(1)
                .describe("检索关键词句（Intake 改写后的 searchQuery）"),
            queryType: queryTypeSchema
                .optional()
                .describe("查询类型：identity / enumeration / tech / default"),
            topics: z
                .array(z.string())
                .optional()
                .describe("主题标签，如 experience、aky"),
            subTasks: z
                .array(z.string())
                .optional()
                .describe("子任务标签，composite 分槽时使用"),
        }),
    }
);
