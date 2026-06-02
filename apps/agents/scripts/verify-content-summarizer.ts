/**
 * ContentSummarizer Zod 单测（不依赖 Ollama）。
 *
 *   pnpm run verify:content-summarizer
 */

import assert from "node:assert/strict";

import {
  contentSummaryResultSchema,
  parseContentSummaryResult,
} from "../src/agentflow/agents/offline/content-summarizer/index.ts";

function testSchema() {
  const parsed = contentSummaryResultSchema.safeParse({
    title: "城管平台技术栈",
    summary: "项目采用 React 与 Spring Boot。",
    bullets: ["前端 React 18", "后端 Java"],
    keywords: ["城管", "React"],
    language: "zh",
    notes: null,
  });
  assert.equal(parsed.success, true);
}

function testParseFallback() {
  const fallback = {
    title: "兜底",
    summary: "短摘要",
    bullets: [] as string[],
    keywords: [] as string[],
    language: "zh" as const,
    notes: null,
  };
  const bad = parseContentSummaryResult({ title: "" }, fallback);
  assert.equal(bad.title, "兜底");

  const ok = parseContentSummaryResult(
    {
      title: "OK",
      summary: "正文摘要",
      bullets: ["a", "b"],
      keywords: ["k1"],
      language: "en",
      notes: "note",
    },
    fallback
  );
  assert.equal(ok.title, "OK");
  assert.equal(ok.language, "en");
  assert.equal(ok.bullets.length, 2);
}

async function main() {
  testSchema();
  testParseFallback();
  console.log("verify:content-summarizer OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
