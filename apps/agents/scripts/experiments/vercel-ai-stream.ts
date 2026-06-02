/**
 * Vercel AI SDK 触达：用 streamText 对接本地 Ollama（与主链自研 SSE 对比）。
 *
 *   pnpm run experiment:vercel-ai -- "你好，用一句话介绍 FamBrain"
 */

import { createOllama } from "ollama-ai-provider";
import { streamText } from "ai";

import { getAgentsConfig } from "@fambrain/agent-config";

async function main() {
  const prompt = process.argv.slice(2).join(" ").trim() || "用一句话说明 RAG 是什么。";
  const { ollama } = getAgentsConfig();
  const modelId = ollama.models.intakeCoordinator;

  const ollamaProvider = createOllama({ baseURL: ollama.baseUrl });
  const model = ollamaProvider(modelId);

  console.log(`model=${modelId}`);
  console.log(`prompt=${prompt}\n---\n`);

  const result = streamText({
    model,
    prompt,
  });

  let chars = 0;
  for await (const chunk of result.textStream) {
    process.stdout.write(chunk);
    chars += chunk.length;
  }

  console.log(`\n---\nchars=${chars}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
