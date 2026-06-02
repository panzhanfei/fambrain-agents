/**
 * ContentOrganizer 规则单测（不依赖 Ollama）。
 *
 *   pnpm run verify:content-organizer
 */

import assert from "node:assert/strict";

import {
  dedupeCitations,
  organizeHits,
  organizeKnowledge,
} from "../src/agentflow/agents/online/content-organizer/index.ts";

function testOrganizeHits() {
  const hits = organizeHits([
    {
      path: "src/doc/a.md",
      title: "A",
      excerpt: "React 18",
      relevance: 0.7,
    },
    {
      path: "src/doc/a.md",
      title: "Doc A",
      excerpt: "TypeScript",
      relevance: 0.9,
    },
    {
      path: "src/doc/b.md",
      title: "B",
      excerpt: "Vite",
      relevance: 0.5,
    },
  ]);

  assert.equal(hits.length, 2);
  assert.equal(hits[0].path, "src/doc/a.md");
  assert.equal(hits[0].relevance, 0.9);
  assert.ok(hits[0].excerpt.includes("React 18"));
  assert.ok(hits[0].excerpt.includes("TypeScript"));
}

function testDedupeCitations() {
  const citations = dedupeCitations([
    { path: "p.md", excerpt: "line one" },
    { path: "p.md", excerpt: "line one" },
    { path: "q.md", excerpt: "other" },
  ]);
  assert.equal(citations.length, 2);
  assert.equal(citations[0].path, "p.md");
}

function testOrganizeKnowledgeEmpty() {
  const r = organizeKnowledge({
    hits: [],
    coverage: "partial",
    notes: null,
  });
  assert.equal(r.coverage, "none");
  assert.equal(r.hits.length, 0);
}

function main() {
  testOrganizeHits();
  testDedupeCitations();
  testOrganizeKnowledgeEmpty();
  console.log("ContentOrganizer 规则单测通过。");
}

main();
