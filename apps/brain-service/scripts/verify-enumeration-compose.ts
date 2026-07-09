/**
 * 列举型 Composer 单测：enumeration 不走 LLM，blocks 条数与 total/hasMore。
 *
 *   pnpm --filter @fambrain/brain-service exec tsx scripts/verify-enumeration-compose.ts
 */
import assert from "node:assert/strict";
import { PROJECTS_SLOT } from "../src/agentflow/brain-service/online/intake-coordinator/composite/composite-slot-queries";
import { organizeKnowledge } from "../src/agentflow/brain-service/online/content-organizer/organize-knowledge";
import { shouldSkipSubQuestionLlm } from "../src/agentflow/brain-service/online/information-analyst/analyze-helpers";
import { composeEnumerationAnswer } from "../src/agentflow/brain-service/online/information-analyst/compose-message";
import { parseKnowledgeHits } from "../src/agentflow/brain-service/online/knowledge-manager/contract/schema";
import { organizeHits } from "../src/agentflow/brain-service/online/content-organizer/organize-hits";
import type { KnowledgeHit } from "../src/agentflow/brain-service/online/knowledge-manager";

const mkHit = (i: number): KnowledgeHit => ({
    path: `data/doc/users/u/corpus/projects/project-${i}.md`,
    title: `project-${i}`,
    excerpt: `summary for project ${i}`,
    relevance: 1 - i * 0.05,
});

console.log("verify-enumeration-compose");

assert.equal(organizeHits([mkHit(1), mkHit(2), mkHit(3)], 8).length, 3);

assert.equal(parseKnowledgeHits([mkHit(1), mkHit(2), mkHit(3), mkHit(4), mkHit(5), mkHit(6)], 8).length, 6);

const organized = organizeKnowledge({
    hits: Array.from({ length: 8 }, (_, i) => mkHit(i + 1)),
    coverage: "partial",
    notes: "列举覆盖 8/36 个项目",
    queryProfile: "enumeration",
});
assert.equal(organized.hits.length, 8, "organizer keeps enumeration maxHits=8");

const subInput = {
    userQuestion: PROJECTS_SLOT.label,
    language: "zh" as const,
    hits: organized.hits,
    coverage: "partial" as const,
    notes: "列举覆盖 8/36 个项目",
    queryType: "enumeration" as const,
    topics: PROJECTS_SLOT.topics,
    enumerationMeta: {
        listKind: "project" as const,
        totalExpected: 36,
        shown: 8,
    },
};
assert.equal(shouldSkipSubQuestionLlm(subInput), true);

const composed = composeEnumerationAnswer({
    hits: organized.hits,
    language: "zh",
    topics: PROJECTS_SLOT.topics,
    enumerationMeta: subInput.enumerationMeta,
    notes: subInput.notes,
});

assert.ok(composed.blocks?.length, "has blocks");
const enumBlock = composed.blocks!.find((b) => b.type === "enumeration");
assert.ok(enumBlock && enumBlock.type === "enumeration");
assert.equal(enumBlock.items.length, 8);
assert.equal(enumBlock.total, 36);
assert.equal(enumBlock.shown, 8);
assert.equal(enumBlock.hasMore, true);
assert.match(composed.answer, /语料共 36 个/);
assert.match(composed.answer, /本节预览 8 个/);
assert.match(composed.answer, /共 2 页/);
assert.match(composed.answer, /^1\. \*\*project-1\*\*$/m, "title-only numbered list");
assert.doesNotMatch(composed.answer, /—/, "no excerpt suffix");

console.log("OK");
