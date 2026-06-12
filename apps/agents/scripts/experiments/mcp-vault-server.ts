/**
 * MCP Server：只读列出 FamBrain vault 文件（stdio）。
 *
 *   pnpm run experiment:mcp-vault
 *
 * Cursor / Claude Desktop 可配置 command 指向本脚本。
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { listVaultFiles } from "../../src/agentflow/knowledge/list-vault-files.ts";
const server = new McpServer({
    name: "fambrain-vault",
    version: "0.1.0",
});
server.tool("list_vault_files", "List all files under data/doc/users/<userId>/vault (read-only; not in RAG corpus).", { userId: z.string().min(1).describe("Actor user id") }, async ({ userId }) => {
    const files = await listVaultFiles(userId);
    return {
        content: [
            {
                type: "text",
                text: JSON.stringify({ userId, count: files.length, files }, null, 2),
            },
        ],
    };
});
const transport = new StdioServerTransport();
await server.connect(transport);
