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
