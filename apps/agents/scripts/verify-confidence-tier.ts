/**
 * Wave D（EV-01～04）：置信分档单测 + KM live 抽检。
 *
 *   pnpm --filter @fambrain/agents run verify:confidence-tier
 */
import { listCorpusUserIds } from "../src/agentflow/agents/offline/knowledge-indexer/list-corpus-users";
import {
    assessConfidence,
    deriveCoverageFromTier,
    shouldCoalesceEmptyHits,
} from "../src/agentflow/agents/online/knowledge-manager/score-candidate";
import { retrieveKnowledge } from "../src/agentflow/agents/online/knowledge-manager/retrieve";

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

console.log("verify-confidence-tier\n— EV-01 assessConfidence —");

assert("identity + personal → high", () => {
    const a = assessConfidence({
        queryProfile: "identity",
        hits: [
            {
                path: "data/doc/u/corpus/personal/个人简历.md",
                title: "t",
                excerpt: "| 姓名 | 潘 |",
                relevance: 0.82,
            },
        ],
        ranked: [
            {
                path: "data/doc/u/corpus/personal/个人简历.md",
                title: "t",
                body: "",
                relevance: 0.82,
                keywordRelevance: 0.5,
                vectorRelevance: 0.3,
                pathBoost: 0.25,
                excerpt: "",
            },
        ],
        recallSource: "hybrid",
        topCandidate: {
            path: "data/doc/u/corpus/personal/个人简历.md",
            title: "t",
            body: "",
            fusionScore: 0.03,
            recallChannel: "hybrid",
        },
        guardApplied: true,
        fillApplied: false,
        candidateCount: 5,
    });
    if (a.tier !== "high") throw new Error(`expected high, got ${a.tier}`);
});

assert("无 hits → low", () => {
    const a = assessConfidence({
        queryProfile: "default",
        hits: [],
        ranked: [],
        recallSource: "empty",
        guardApplied: false,
        fillApplied: false,
        candidateCount: 0,
    });
    if (a.tier !== "low") throw new Error(`expected low, got ${a.tier}`);
});

assert("deriveCoverageFromTier high → sufficient", () => {
    if (deriveCoverageFromTier("high", [{ path: "a", title: "t", excerpt: "x", relevance: 0.5 }], 0.5) !== "sufficient") {
        throw new Error("high 应为 sufficient");
    }
});

assert("shouldCoalesceEmptyHits low 弱 top 不 coalesce", () => {
    if (shouldCoalesceEmptyHits("low", 0.1)) {
        throw new Error("low+弱 top 不应 coalesce");
    }
    if (!shouldCoalesceEmptyHits("high", 0.1)) {
        throw new Error("high 应 coalesce");
    }
});

console.log("\n— KM live tier —");

const main = async () => {
    const ids = await listCorpusUserIds();
    const corpusUserId =
        process.env.FAMBRAIN_CORPUS_USER_ID?.trim() || ids[0];
    if (!corpusUserId) {
        console.log("  (skip) 无 corpus");
        return;
    }

    const cases = [
        {
            label: "identity",
            input: {
                corpusUserId,
                searchQuery: "个人简介 简历 姓名",
                topics: [] as string[],
                subTasks: [] as string[],
                queryType: "identity" as const,
                candidates: [],
            },
            expectTier: "high" as const,
        },
        {
            label: "enumeration",
            input: {
                corpusUserId,
                searchQuery: "我在哪几家公司上过班？",
                topics: [] as string[],
                subTasks: [] as string[],
                queryType: "enumeration" as const,
                candidates: [],
            },
            expectTier: "high" as const,
        },
    ];

    for (const c of cases) {
        const r = await retrieveKnowledge(c.input);
        if (!r.confidenceTier) {
            throw new Error(`${c.label} 缺少 confidenceTier`);
        }
        if (r.confidenceTier !== c.expectTier) {
            throw new Error(
                `${c.label} tier 期望 ${c.expectTier} 实际 ${r.confidenceTier}`
            );
        }
        console.log(
            `  ✓ ${c.label} tier=${r.confidenceTier} coverage=${r.coverage} hits=${r.hits.length}`
        );
    }
};

await main().catch((e) => {
    console.error(`  ✗ live: ${e instanceof Error ? e.message : e}`);
    process.exitCode = 1;
});

if (process.exitCode) {
    console.log("\nFAILED");
    process.exit(process.exitCode);
}
console.log("\nOK");
