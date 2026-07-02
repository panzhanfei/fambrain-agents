/**
 * 在线 Agent Zod 解析单测（不依赖 Ollama）。
 *
 *   pnpm run verify:agent-schemas
 */
import assert from "node:assert/strict";
import { parseIntakeRoutingDecision } from "../src/agentflow/agents/online/intake-coordinator";
import { parseFactCheckerResult } from "../src/agentflow/agents/online/fact-checker/schema";
import { parseKnowledgeRetrievalResult } from "../src/agentflow/agents/online/knowledge-manager/schema";
import { parseAnalystResult } from "../src/agentflow/agents/online/information-analyst/schema";
import { buildRuleBasedFactCheck } from "../src/agentflow/agents/online/fact-checker/check-helpers";
import { buildFallbackAnswer } from "../src/agentflow/agents/online/information-analyst/analyze-helpers";
const testIntake = () => {
    const ok = parseIntakeRoutingDecision({
        intent: "retrieve_and_answer",
        needsRetrieval: true,
        searchQuery: " 城管平台 ",
        subTasks: ["a", ""],
        topics: ["project"],
        language: "zh",
        confidence: 1.5,
        queryType: "tech",
        clarifyingQuestion: null,
        briefReply: null,
    });
    assert.ok(ok);
    assert.equal(ok.searchQuery, "城管平台");
    assert.equal(ok.subTasks.length, 1);
    assert.equal(ok.confidence, 1);
    assert.equal(ok.queryType, "tech");
    const summarize = parseIntakeRoutingDecision({
        intent: "summarize_content",
        needsRetrieval: true,
        searchQuery: "城管平台 总结",
        subTasks: [],
        topics: ["project"],
        language: "zh",
        confidence: 0.88,
        queryType: null,
        clarifyingQuestion: null,
        briefReply: null,
    });
    assert.equal(summarize?.intent, "summarize_content");
    assert.equal(parseIntakeRoutingDecision({ intent: "invalid" }), null);
    const chitchat = parseIntakeRoutingDecision({
        intent: "chitchat",
        needsRetrieval: false,
        searchQuery: "",
        subTasks: [],
        topics: [],
        language: "zh",
        confidence: 0.98,
        queryType: null,
        clarifyingQuestion: null,
        briefReply: "你好，我是 FamBrain 助手。",
        retrievalPlan: [],
    });
    assert.equal(chitchat?.intent, "chitchat");
    assert.equal(chitchat?.userFactKey, null);
};
const testKnowledgeManager = () => {
    const fallback = {
        hits: [],
        coverage: "none" as const,
        notes: null,
    };
    const r = parseKnowledgeRetrievalResult({
        hits: [
            {
                path: "a.md",
                title: "A",
                excerpt: "excerpt",
                relevance: 2,
            },
            { path: "", excerpt: "x" },
        ],
        coverage: "partial",
        notes: "  note  ",
    }, fallback);
    assert.equal(r.hits.length, 1);
    assert.equal(r.hits[0].relevance, 1);
    assert.equal(r.coverage, "partial");
    assert.equal(r.notes, "note");
};
const testFactChecker = () => {
    const fallback = buildRuleBasedFactCheck({
        userQuestion: "q",
        intent: "retrieve_and_answer",
        needsRetrieval: true,
        searchQuery: "q",
        subTasks: [],
        topics: [],
        language: "zh",
        hits: [],
        coverage: "none",
        notes: null,
        retryCount: 1,
    });
    const r = parseFactCheckerResult({
        passed: false,
        evidenceScore: 0.2,
        refinedSearchQuery: "refined",
        checkerNotes: null,
        issues: [{ code: "no_hits_when_needed", message: "无命中" }],
    }, fallback, 1);
    assert.equal(r.passed, true);
    assert.equal(r.refinedSearchQuery, null);
};
const testAnalyst = () => {
    const fallback = buildFallbackAnswer({
        userQuestion: "q",
        language: "zh",
        subTasks: [],
        hits: [
            {
                path: "a.md",
                title: "A",
                excerpt: "one",
                relevance: 0.8,
            },
        ],
        coverage: "sufficient",
        notes: null,
        memoryBlock: null,
    });
    const r = parseAnalystResult({
        answer: "回答",
        citations: [
            { path: "a.md", excerpt: "one" },
            { path: "a.md", excerpt: "one" },
        ],
        confidence: 0.9,
        insufficientEvidence: false,
    }, fallback);
    assert.equal(r.answer, "回答");
    assert.equal(r.citations.length, 1);
};
const main = () => {
    testIntake();
    testKnowledgeManager();
    testFactChecker();
    testAnalyst();
    console.log("在线 Agent Zod 单测通过。");
};
main();
