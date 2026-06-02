# FamBrain 实验脚本（触达级）

与主聊天链路 **解耦**，用于 P1 技术栈触达与面试演示。实现位于 `apps/agents/scripts/experiments/`。

| 命令（仓库根目录） | 技术 | 说明 |
|-------------------|------|------|
| `pnpm run experiment:mcp-vault` | MCP SDK | stdio MCP Server，工具 `list_vault_files` 只读列 `vault/` |
| `pnpm run experiment:recall-compare -- <userId> "query"` | Recall vs LlamaIndex | 同 query 对比向量检索与关键词轻量 RAG |
| `pnpm run experiment:vercel-ai -- "prompt"` | Vercel AI SDK | `streamText` + Ollama，主链仍用自研 SSE |

**ContentSummarizer（D9）：**

| 命令 | 说明 |
|------|------|
| `pnpm run verify:content-summarizer` | Zod schema 单测 |
| `pnpm run summarize:document -- <file.md>` | CLI 摘要（需 Ollama） |

**MCP 配置示例（Cursor）：** command 填 `pnpm`，args 填 `run experiment:mcp-vault`（cwd 为仓库根目录）。
