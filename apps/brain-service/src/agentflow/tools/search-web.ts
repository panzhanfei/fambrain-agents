import { tool } from "@langchain/core/tools";
import { z } from "zod";

export type WebSearchSnippet = {
    title: string;
    url: string;
    snippet: string;
};

const searchTavily = async (
    query: string,
    apiKey: string
): Promise<WebSearchSnippet[]> => {
    const res = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            api_key: apiKey,
            query,
            max_results: 5,
            include_answer: false,
        }),
    });
    if (!res.ok) {
        throw new Error(`Tavily HTTP ${res.status}`);
    }
    const body = (await res.json()) as {
        results?: Array<{ title?: string; url?: string; content?: string }>;
    };
    return (body.results ?? []).map((r) => ({
        title: r.title ?? r.url ?? "result",
        url: r.url ?? "",
        snippet: (r.content ?? "").slice(0, 400),
    }));
};

/**
 * 外部事实检索。需 TAVILY_API_KEY 或 FAMBRAIN_WEB_SEARCH_ENABLED=1 + key。
 * corpus-first：主 pipeline 在 pathPlan.tool / 槽 topics.external 时由 ToolOrchestrator 调用。
 */
export const searchWebTool = tool(
    async (input) => {
        const apiKey =
            process.env.TAVILY_API_KEY?.trim() ||
            process.env.FAMBRAIN_TAVILY_API_KEY?.trim();
        const enabled =
            process.env.FAMBRAIN_WEB_SEARCH_ENABLED === "1" || Boolean(apiKey);

        if (!enabled || !apiKey) {
            return JSON.stringify({
                status: "disabled",
                query: input.query,
                message:
                    "Web search is not configured. Set TAVILY_API_KEY or FAMBRAIN_WEB_SEARCH_ENABLED=1.",
            });
        }

        try {
            const results = await searchTavily(input.query, apiKey);
            if (results.length === 0) {
                return JSON.stringify({
                    status: "empty",
                    query: input.query,
                    message: "联网检索无结果。",
                    results: [],
                });
            }
            return JSON.stringify({
                status: "ok",
                query: input.query,
                results,
            });
        } catch (e) {
            return JSON.stringify({
                status: "error",
                query: input.query,
                message: e instanceof Error ? e.message : String(e),
            });
        }
    },
    {
        name: "search_web",
        description:
            "Search the public web for external facts (company news, market trends) when corpus has no coverage.",
        schema: z.object({
            query: z.string().min(1).describe("Search query"),
        }),
    }
);
