/**
 * ContentSummarizer Zod 单测（不依赖 Ollama）。
 *
 *   pnpm run verify:content-summarizer
 */
import assert from "node:assert/strict";
import { buildSummarizeSourceText, contentSummaryResultSchema, formatSummaryAsAnswer, parseContentSummaryResult, } from "../src/agentflow/brain-service/online/content-summarizer/index";
const testSchema = () => {
    const parsed = contentSummaryResultSchema.safeParse({
        title: "城管平台技术栈",
        summary: "项目采用 React 与 Spring Boot。",
        bullets: ["前端 React 18", "后端 Java"],
        keywords: ["城管", "React"],
        language: "zh",
        notes: null,
    });
    assert.equal(parsed.success, true);
};
const testParseFallback = () => {
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
    const ok = parseContentSummaryResult({
        title: "OK",
        summary: "正文摘要",
        bullets: ["a", "b"],
        keywords: ["k1"],
        language: "en",
        notes: "note",
    }, fallback);
    assert.equal(ok.title, "OK");
    assert.equal(ok.language, "en");
    assert.equal(ok.bullets.length, 2);
};
const testFormatAndSource = () => {
    const answer = formatSummaryAsAnswer({
        title: "城管平台",
        summary: "React 与小程序。",
        bullets: ["前端 React 18"],
        keywords: ["城管", "React"],
        language: "zh",
        notes: null,
    });
    assert.match(answer, /^## 城管平台/);
    assert.match(answer, /React 与小程序/);
    const { text } = buildSummarizeSourceText({
        userQuestion: "总结城管",
        decision: {
            intent: "summarize_content",
            searchQuery: "城管平台",
            subTasks: [],
            topics: ["project"],
            language: "zh",
            confidence: 0.9,
            clarifyingQuestion: null,
            briefReply: null,
        },
        hits: [
            {
                path: "a.md",
                title: "城管",
                excerpt: "React 18",
                relevance: 0.9,
            },
        ],
    });
    assert.match(text, /React 18/);
};
const main = async () => {
    testSchema();
    testParseFallback();
    testFormatAndSource();
    console.log("verify:content-summarizer OK");
};
main().catch((err) => {
    console.error(err);
    process.exit(1);
});
