/**
 * P0-12 / D5-5：Analyst 在 hits 空或 coverage=none 时跳过 LLM，直出 fallback。
 *
 *   pnpm --filter @fambrain/agents run verify:analyst-empty-hits
 */
import {
    buildFallbackAnswer,
    shouldSkipAnalystLlm,
    streamAnalyzeInformation,
    type InformationAnalystInput,
} from "../src/agentflow/agents/online/information-analyst/index.ts";
import { bootstrapAgentsRuntime } from "../src/config/index.ts";

const HALLUCINATION_NAMES = /陈明|Charlie|赵一|潘展飞/;

const emptyHitsInput = (
    overrides: Partial<InformationAnalystInput> = {}
): InformationAnalystInput => ({
    userQuestion: "我的名字是什么？",
    language: "zh",
    subTasks: ["提取姓名"],
    hits: [],
    coverage: "none",
    notes: "二次检索后仍无命中，分析师须 insufficientEvidence。",
    memoryBlock: null,
    ...overrides,
});

const assertSync = (name: string, fn: () => void) => {
    try {
        fn();
        console.log(`  ✓ ${name}`);
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`  ✗ ${name}: ${msg}`);
        process.exitCode = 1;
    }
};

console.log("verify-analyst-empty-hits\n— shouldSkipAnalystLlm —");

assertSync("hits=[] → skip", () => {
    if (!shouldSkipAnalystLlm(emptyHitsInput())) {
        throw new Error("应 skip");
    }
});

assertSync("coverage=none → skip", () => {
    if (
        !shouldSkipAnalystLlm(
            emptyHitsInput({
                coverage: "none",
                hits: [
                    {
                        path: "x.md",
                        title: "x",
                        excerpt: "y",
                        relevance: 0.5,
                    },
                ],
            })
        )
    ) {
        throw new Error("coverage=none 仍应 skip");
    }
});

assertSync("有 hits 且 partial → 不 skip", () => {
    if (
        shouldSkipAnalystLlm(
            emptyHitsInput({
                coverage: "partial",
                hits: [
                    {
                        path: "personal/简历.md",
                        title: "简历",
                        excerpt: "潘展飞",
                        relevance: 1,
                    },
                ],
            })
        )
    ) {
        throw new Error("partial 有 hits 不应 skip");
    }
});

console.log("\n— buildFallbackAnswer —");

assertSync("空 hits → insufficientEvidence", () => {
    const r = buildFallbackAnswer(emptyHitsInput());
    if (!r.insufficientEvidence) throw new Error("应 insufficientEvidence");
    if (HALLUCINATION_NAMES.test(r.answer)) {
        throw new Error(`fallback 不应含编造姓名: ${r.answer}`);
    }
    if (!/没有检索到|No relevant content/i.test(r.answer)) {
        throw new Error("应提示知识库无相关内容");
    }
});

await bootstrapAgentsRuntime();

console.log("\n— streamAnalyzeInformation（无 Ollama 调用）—");

const runStreamCase = async (
    name: string,
    input: InformationAnalystInput,
    check: (result: Awaited<ReturnType<typeof collectStream>>) => void
) => {
    try {
        const out = await collectStream(input);
        check(out);
        console.log(`  ✓ ${name}`);
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`  ✗ ${name}: ${msg}`);
        process.exitCode = 1;
    }
};

const collectStream = async (input: InformationAnalystInput) => {
    const chunks: string[] = [];
    const gen = streamAnalyzeInformation(input);
    let result;
    while (true) {
        const next = await gen.next();
        if (next.done) {
            result = next.value;
            break;
        }
        if (next.value.type === "assistant") {
            chunks.push(next.value.text);
        }
    }
    return { result: result!, assistantTexts: chunks };
};

await runStreamCase("P0-12 路径 B：hits=[] + FC 放行后不调 LLM", emptyHitsInput(), ({ result, assistantTexts }) => {
    if (!result.insufficientEvidence) {
        throw new Error("应 insufficientEvidence");
    }
    if (HALLUCINATION_NAMES.test(result.answer)) {
        throw new Error(`不得编造姓名: ${result.answer}`);
    }
    if (assistantTexts.length !== 1) {
        throw new Error(`应单次 assistant 输出，实际 ${assistantTexts.length} 段`);
    }
});

await runStreamCase("英文空 hits", emptyHitsInput({ language: "en" }), ({ result }) => {
    if (!result.insufficientEvidence) throw new Error("应 insufficientEvidence");
    if (!/No relevant content/i.test(result.answer)) {
        throw new Error("英文 fallback 不符");
    }
});

if (process.exitCode) {
    console.log("\nFAILED");
    process.exit(process.exitCode);
}
console.log("\nOK");
