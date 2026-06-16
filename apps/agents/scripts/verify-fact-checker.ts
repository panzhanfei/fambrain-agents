/**
 * FactChecker 本地验证脚本（不依赖 HTTP / 登录）。
 *
 * 用法（仓库根目录 .env 已配置时）：
 *   pnpm --filter @fambrain/agents exec tsx --env-file=../../.env scripts/verify-fact-checker.ts
 *   pnpm --filter @fambrain/agents exec tsx --env-file=../../.env scripts/verify-fact-checker.ts --llm
 *
 * --llm  额外调用 Ollama 跑 completeFactCheck（需本地 Ollama 已启动）
 */
import { applyFactCheckGuards, buildRuleBasedFactCheck, completeFactCheck, type FactCheckerInput, type FactCheckerResult, } from "../src/agentflow/agents/online/fact-checker/index.ts";
import { mergeRetrySearchQuery } from "../src/agentflow/agents/online/fact-checker/refined-search-query.ts";
const runLlm = process.argv.includes("--llm");
type Case = {
    name: string;
    input: FactCheckerInput;
    expect: (r: FactCheckerResult) => void;
};
const cases: Case[] = [
    {
        name: "无需检索 → 直接放行",
        input: {
            userQuestion: "React 和 Vue 的区别是什么？",
            intent: "direct_answer",
            needsRetrieval: false,
            searchQuery: "",
            subTasks: [],
            topics: [],
            language: "zh",
            hits: [],
            coverage: "none",
            notes: null,
            retryCount: 0,
        },
        expect: (r) => {
            if (!r.passed)
                throw new Error("应 passed=true");
        },
    },
    {
        name: "首次无命中 → 打回并带 refinedSearchQuery",
        input: {
            userQuestion: "城管平台用了什么技术？",
            intent: "retrieve_and_answer",
            needsRetrieval: true,
            searchQuery: "城管",
            subTasks: ["列出技术栈"],
            topics: ["project"],
            language: "zh",
            hits: [],
            coverage: "none",
            notes: null,
            retryCount: 0,
        },
        expect: (r) => {
            if (r.passed)
                throw new Error("应 passed=false");
            if (!r.refinedSearchQuery?.trim()) {
                throw new Error("应提供 refinedSearchQuery");
            }
        },
    },
    {
        name: "已重试仍无命中 → 强制放行",
        input: {
            userQuestion: "城管平台用了什么技术？",
            intent: "retrieve_and_answer",
            needsRetrieval: true,
            searchQuery: "西安奥卡云 城市管理平台 React TypeScript",
            subTasks: [],
            topics: ["project"],
            language: "zh",
            hits: [],
            coverage: "none",
            notes: null,
            retryCount: 1,
        },
        expect: (r) => {
            if (!r.passed)
                throw new Error("retryCount=1 应 passed=true");
            if (!r.checkerNotes?.includes("未覆盖")) {
                throw new Error("应有分析师勿编造的 checkerNotes");
            }
        },
    },
    {
        name: "命中相关 → 通过",
        input: {
            userQuestion: "城管平台用了什么技术？",
            intent: "retrieve_and_answer",
            needsRetrieval: true,
            searchQuery: "城市管理平台 React TypeScript",
            subTasks: ["技术栈"],
            topics: ["project"],
            language: "zh",
            hits: [
                {
                    path: "src/doc/users/demo/corpus/projects/城市管理平台.md",
                    title: "城市管理平台",
                    excerpt: "技术栈：React 18、TypeScript、Vite、Ant Design、微信小程序。",
                    relevance: 0.88,
                },
            ],
            coverage: "partial",
            notes: null,
            retryCount: 0,
        },
        expect: (r) => {
            if (!r.passed)
                throw new Error("应 passed=true");
            if (r.evidenceScore < 0.4)
                throw new Error("evidenceScore 过低");
        },
    },
    {
        name: "personal 命中 → 直接放行（即使字面匹配度低）",
        input: {
            userQuestion: "我的名字",
            intent: "retrieve_and_answer",
            needsRetrieval: true,
            searchQuery: "姓名",
            subTasks: [],
            topics: ["personal"],
            language: "zh",
            hits: [
                {
                    path: "src/doc/users/demo/corpus/personal/个人简历-潘展飞.md",
                    title: "个人简历",
                    excerpt: "姓名：潘展飞。10 年前端开发经验。",
                    relevance: 0.72,
                },
            ],
            coverage: "partial",
            notes: null,
            retryCount: 0,
        },
        expect: (r) => {
            if (!r.passed)
                throw new Error("personal/ 有 hits 应 passed=true");
            if (r.refinedSearchQuery)
                throw new Error("不应打回 refinedSearchQuery");
        },
    },
    {
        name: "命中跑偏 → 打回",
        input: {
            userQuestion: "E-HR 用的什么数据库？",
            intent: "retrieve_and_answer",
            needsRetrieval: true,
            searchQuery: "E-HR 数据库 Prisma",
            subTasks: [],
            topics: ["project"],
            language: "zh",
            hits: [
                {
                    path: "src/doc/users/demo/corpus/projects/sentinel.md",
                    title: "Sentinel 监控",
                    excerpt: "Prometheus Grafana 告警规则与大盘配置。",
                    relevance: 0.3,
                },
            ],
            coverage: "partial",
            notes: null,
            retryCount: 0,
        },
        expect: (r) => {
            if (r.passed)
                throw new Error("应 passed=false（命中与问题无关）");
            if (!r.refinedSearchQuery?.toLowerCase().includes("e-hr")) {
                throw new Error("refinedSearchQuery 应含 E-HR 相关词");
            }
        },
    },
];
const printResult = (name: string, r: FactCheckerResult) => {
    console.log(`  passed=${r.passed} score=${r.evidenceScore.toFixed(2)}`);
    if (r.refinedSearchQuery)
        console.log(`  refinedSearchQuery: ${r.refinedSearchQuery}`);
    if (r.checkerNotes)
        console.log(`  checkerNotes: ${r.checkerNotes}`);
    if (r.issues.length) {
        console.log(`  issues: ${r.issues.map((i) => i.code).join(", ")}`);
    }
};
const main = async () => {
    console.log("=== FactChecker 规则兜底（buildRuleBasedFactCheck）===\n");
    let failed = 0;
    for (const c of cases) {
        process.stdout.write(`• ${c.name} … `);
        try {
            const r = buildRuleBasedFactCheck(c.input);
            c.expect(r);
            console.log("OK");
            printResult(c.name, r);
        }
        catch (e) {
            failed += 1;
            console.log("FAIL");
            console.error(`  ${e instanceof Error ? e.message : String(e)}`);
        }
        console.log();
    }
    console.log("=== mergeRetrySearchQuery / applyFactCheckGuards ===\n");
    const merge = mergeRetrySearchQuery(
        { searchQuery: "姓名", userQuestion: "姓名", subTasks: [], topics: [] },
        "姓名 全名 完整称呼"
    );
    if (merge.shouldRetry) {
        failed += 1;
        console.error("• meta refined 合并应 skip retry … FAIL");
    }
    else {
        console.log("• meta refined 合并无增量 … OK");
    }
    const mergeWithUserQuestion = mergeRetrySearchQuery(
        { searchQuery: "姓名", userQuestion: "我的名字", subTasks: [], topics: [] },
        "姓名 全名 完整称呼"
    );
    if (mergeWithUserQuestion.shouldRetry) {
        failed += 1;
        console.error("• meta refined 不应因 userQuestion 误触发 retry … FAIL");
    }
    else {
        console.log("• meta refined 无 userQuestion 增量 … OK");
    }
    const mergeWithCorpusTerms = mergeRetrySearchQuery(
        { searchQuery: "姓名", userQuestion: "我的名字", subTasks: [], topics: [] },
        "个人简介 简历 全名"
    );
    if (!mergeWithCorpusTerms.shouldRetry || !mergeWithCorpusTerms.query.includes("个人简介")) {
        failed += 1;
        console.error("• 含语料词的 refined 合并应 retry … FAIL");
    }
    else {
        console.log(`• 含语料词 refined 合并 … OK → ${mergeWithCorpusTerms.query}`);
    }
    const guarded = applyFactCheckGuards(
        {
            userQuestion: "姓名",
            intent: "retrieve_and_answer",
            needsRetrieval: true,
            searchQuery: "姓名",
            subTasks: [],
            topics: [],
            language: "zh",
            hits: [
                {
                    path: "src/doc/users/demo/corpus/projects/x.md",
                    title: "x",
                    excerpt: " unrelated ",
                    relevance: 0.2,
                },
            ],
            coverage: "partial",
            notes: null,
            retryCount: 0,
        },
        {
            passed: false,
            evidenceScore: 0.2,
            refinedSearchQuery: "姓名 全名 完整称呼",
            checkerNotes: null,
            issues: [{ code: "hits_irrelevant", message: "test" }],
        }
    );
    if (!guarded.passed || guarded.refinedSearchQuery !== null) {
        failed += 1;
        console.error("• applyFactCheckGuards meta 无增量应 pass … FAIL");
    }
    else {
        console.log("• applyFactCheckGuards meta 无增量放行 … OK");
    }
    console.log();
    if (runLlm) {
        console.log("=== FactChecker LLM（completeFactCheck，需 Ollama）===\n");
        const sample = cases[3].input;
        try {
            const r = await completeFactCheck(sample);
            console.log("• 有命中样本 … OK");
            printResult("LLM 样本", r);
            if (!r.passed) {
                failed += 1;
                console.error("  期望 LLM 也通过有命中样本");
            }
        }
        catch (e) {
            failed += 1;
            console.error("• LLM 调用失败:", e instanceof Error ? e.message : String(e));
        }
        console.log();
    }
    else {
        console.log("跳过 LLM（加 --llm 可测 completeFactCheck + Ollama）\n");
    }
    if (failed > 0) {
        console.error(`共 ${failed} 项失败`);
        process.exit(1);
    }
    console.log("全部通过。");
};
main();
