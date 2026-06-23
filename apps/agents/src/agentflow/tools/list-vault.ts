import { tool } from "@langchain/core/tools";
import { listVaultFiles } from "@fambrain/corpus";
import { z } from "zod";
import { getToolContext } from "./context";

export const listVaultFilesTool = tool(
    async (input) => {
        const ctx = getToolContext();
        const userId = input.userId?.trim() || ctx.actorUserId;
        const files = await listVaultFiles(userId);
        return JSON.stringify({
            userId,
            count: files.length,
            files: files.slice(0, 50).map((f) => ({
                relativePath: f.relativePath,
                sizeBytes: f.sizeBytes,
            })),
        });
    },
    {
        name: "list_vault_files",
        description:
            "只读列举 vault 私人原件（PDF/Word/图片上传），不参与 RAG 检索。与 MCP experiment:mcp-vault 同源。",
        schema: z.object({
            userId: z
                .string()
                .optional()
                .describe("用户 id；省略则用当前 actorUserId"),
        }),
    }
);
