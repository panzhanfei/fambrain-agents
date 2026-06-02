/**
 * Recall（关键词轻量 RAG）vs LlamaIndex 向量检索对比。
 *
 *   pnpm run experiment:recall-compare -- <corpusUserId> "<query>"
 *
 * 需 Ollama embed + Chroma 已入库。
 */

import { vectorRetrieve } from "../../src/agentflow/agents/online/knowledge-manager/vector-retrieve.ts";
import { recallKeywordRetrieve } from "../../src/agentflow/knowledge/recall-keyword-retrieve.ts";

function printHits(
  label: string,
  hits: { path: string; title: string; score?: number }[]
) {
  console.log(`\n=== ${label} (${hits.length}) ===`);
  for (const [i, h] of hits.entries()) {
    const score =
      "score" in h && typeof h.score === "number"
        ? ` score=${h.score.toFixed(3)}`
        : "";
    console.log(`${i + 1}. ${h.path}${score}`);
    console.log(`   ${h.title}`);
  }
}

async function main() {
  const corpusUserId = process.argv[2]?.trim();
  const query = process.argv.slice(3).join(" ").trim();

  if (!corpusUserId || !query) {
    console.error(
      "Usage: pnpm run experiment:recall-compare -- <corpusUserId> \"<query>\""
    );
    process.exit(1);
  }

  console.log(`corpusUserId=${corpusUserId}`);
  console.log(`query=${query}`);

  const [vectorHits, recallHits] = await Promise.all([
    vectorRetrieve(corpusUserId, query, 8),
    recallKeywordRetrieve(corpusUserId, query, 8),
  ]);

  printHits(
    "LlamaIndex + Chroma (vectorRetrieve)",
    vectorHits.map((h) => ({ path: h.path, title: h.title, score: h.score }))
  );
  printHits("Recall keyword (recallKeywordRetrieve)", recallHits);

  const vectorPaths = new Set(vectorHits.map((h) => h.path));
  const recallPaths = new Set(recallHits.map((h) => h.path));
  const overlap = [...vectorPaths].filter((p) => recallPaths.has(p));
  console.log(`\npath overlap: ${overlap.length} / vector ${vectorPaths.size}`);
  if (overlap.length) console.log(overlap.join("\n"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
