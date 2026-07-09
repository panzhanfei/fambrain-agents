import { tool } from "@langchain/core/tools";
import { z } from "zod";

/**
 * 预留：外部事实检索（公司背景、新闻等）。
 * 主 pipeline 仍 corpus-first；启用需 FAMBRAIN_WEB_SEARCH_ENABLED=1 + 后续 provider 接入。
 */
export const searchWebTool = tool(
    async (input) => {
        if (process.env.FAMBRAIN_WEB_SEARCH_ENABLED !== "1") {
            return JSON.stringify({
                status: "disabled",
                query: input.query,
                message:
                    "Web search is not configured. Use retrieve_corpus for personal knowledge base facts.",
            });
        }
        return JSON.stringify({
            status: "not_implemented",
            query: input.query,
            message:
                "FAMBRAIN_WEB_SEARCH_ENABLED=1 but no provider is wired yet.",
        });
    },
    {
        name: "search_web",
        description:
            "Reserved: search the public web for external facts (company background, news) when corpus has no coverage. Disabled unless FAMBRAIN_WEB_SEARCH_ENABLED=1.",
        schema: z.object({
            query: z.string().min(1).describe("Search query"),
        }),
    }
);
