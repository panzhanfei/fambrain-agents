/**
 * 内容摘要师 CLI：对本地 Markdown 生成结构化摘要。
 *
 *   pnpm run summarize:document -- path/to/file.md
 */

import { summarizeMarkdownFile } from "../src/agentflow/agents/offline/content-summarizer/index.ts";

async function main() {
  const absPath = process.argv[2]?.trim();
  if (!absPath) {
    console.error("Usage: pnpm run summarize:document -- <path-to.md>");
    process.exit(1);
  }

  const result = await summarizeMarkdownFile(absPath);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
