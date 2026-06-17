/**
 * KnowledgeManager 检索规则验证（KM-07）：不测全链路 / Chroma，只测 rank + pathBoost。
 *
 *   pnpm --filter @fambrain/agents run verify:km-retrieve
 */
import {
    computeRelevance,
    getPathBoost,
    rankCandidates,
} from "../src/agentflow/agents/online/knowledge-manager/retrieve-helpers.ts";
import {
    getProfileRecallParams,
} from "../src/agentflow/agents/online/knowledge-manager/km-config.ts";
import {
    inferQueryProfile,
    resolveQueryProfile,
} from "../src/agentflow/agents/online/knowledge-manager/query-profile.ts";

const pickExcerpt = (body: string) => body.slice(0, 120);

const assert = (name: string, fn: () => void) => {
    try {
        fn();
        console.log(`  ✓ ${name}`);
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`  ✗ ${name}: ${msg}`);
        process.exitCode = 1;
    }
};

const personalPath =
    "data/doc/users/u/corpus/personal/个人简历.md";
const resumeProjectPath =
    "data/doc/users/u/corpus/projects/resume.md";

console.log("verify-km-retrieve\n— pathBoost —");

assert("personal/ 加分", () => {
    if (getPathBoost(personalPath) !== 0.25) {
        throw new Error(`expected 0.25, got ${getPathBoost(personalPath)}`);
    }
});

assert("projects/resume.md 减分", () => {
    if (getPathBoost(resumeProjectPath) !== -0.2) {
        throw new Error(`expected -0.2, got ${getPathBoost(resumeProjectPath)}`);
    }
});

assert("relevance 封顶 1.0", () => {
    if (computeRelevance(0.8, 0.5, 0.25) !== 1) {
        throw new Error("应封顶 1.0");
    }
});

console.log("\n— rank（姓名类：personal 应胜过 projects/resume）—");

assert("同等 token/vector 时 personal Top1", () => {
    const body =
        "| 姓名 | 潘展飞 |\n\n项目简历模板，含姓名、简历等词。";
    const ranked = rankCandidates(
        [
            {
                path: resumeProjectPath,
                title: "resume",
                body,
                score: 0.5,
            },
            {
                path: personalPath,
                title: "个人简历",
                body,
                score: 0.5,
            },
        ],
        tokenize("我的名字是什么"),
        pickExcerpt
    );
    const top = ranked[0];
    if (!top?.path.includes("/personal/")) {
        throw new Error(`Top1 应为 personal，实际 ${top?.path}`);
    }
    if (top.pathBoost !== 0.25) {
        throw new Error(`pathBoost 应为 0.25，实际 ${top.pathBoost}`);
    }
});

assert("token 全未命中时 pathBoost 仍可排前（兜底场景）", () => {
    const ranked = rankCandidates(
        [
            {
                path: resumeProjectPath,
                title: "resume",
                body: "unrelated english only",
                score: 0.3,
            },
            {
                path: personalPath,
                title: "个人简历",
                body: "unrelated english only",
                score: 0.9,
            },
        ],
        [],
        pickExcerpt
    );
    const top = ranked[0];
    if (!top?.path.includes("/personal/")) {
        throw new Error(
            `兜底应优先 personal（pathBoost），实际 ${top?.path} relevance=${top?.relevance}`
        );
    }
});

console.log("\n— queryProfile（KM-08/09）—");

assert("identity：我的名字是什么？", () => {
    if (inferQueryProfile("我的名字是什么？", []) !== "identity") {
        throw new Error("应为 identity");
    }
    const { maxHits, vectorTopK } = getProfileRecallParams("identity");
    if (maxHits !== 4 || vectorTopK !== 12) {
        throw new Error(`identity 参数应为 12/4，实际 ${vectorTopK}/${maxHits}`);
    }
});

assert("enumeration：哪几家公司上过班", () => {
    if (inferQueryProfile("我在哪几家公司上过班？", []) !== "enumeration") {
        throw new Error("应为 enumeration");
    }
    const { maxHits, vectorTopK } = getProfileRecallParams("enumeration");
    if (maxHits !== 8 || vectorTopK !== 24) {
        throw new Error(`enumeration 参数应为 24/8，实际 ${vectorTopK}/${maxHits}`);
    }
});

assert("tech：城管平台技术栈", () => {
    if (inferQueryProfile("城管平台用了什么技术栈？", []) !== "tech") {
        throw new Error("应为 tech");
    }
});

assert("Intake queryType 优先于规则", () => {
    const p = resolveQueryProfile("城管平台技术栈", [], "default");
    if (p !== "default") {
        throw new Error("应使用 Intake 的 default");
    }
});

function tokenize(q: string): string[] {
    return q
        .toLowerCase()
        .split(/[^a-z0-9\u4e00-\u9fff]+/i)
        .filter((t) => t.length >= 2);
}

if (process.exitCode) {
    console.log("\nFAILED");
    process.exit(process.exitCode);
}
console.log("\nOK");
