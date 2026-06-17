/**
 * HY-02～03：RRF 融合 + Hybrid 并行召回验证。
 *
 *   pnpm --filter @fambrain/agents run verify:hybrid-recall
 */
import { fuseRrf } from "../src/agentflow/agents/online/knowledge-manager/fusion-rrf.ts";
import { hybridRecall } from "../src/agentflow/agents/online/knowledge-manager/hybrid-recall.ts";
import { sparseScoreToRelevance } from "../src/agentflow/agents/online/knowledge-manager/retrieve-helpers.ts";
import { listCorpusUserIds } from "../src/agentflow/agents/offline/knowledge-indexer/list-corpus-users.ts";

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

console.log("verify-hybrid-recall\n— RRF —");

assert("双路均 rank1 的 path 融合分最高", () => {
    const fused = fuseRrf([
        { paths: ["a.md", "b.md", "c.md"] },
        { paths: ["a.md", "c.md", "b.md"] },
    ]);
    if (fused[0]?.path !== "a.md") {
        throw new Error(`Top1 应为 a.md，实际 ${fused[0]?.path}`);
    }
});

assert("仅一路出现的 path 仍入榜", () => {
    const fused = fuseRrf([
        { paths: ["only-sparse.md"] },
        { paths: ["only-vector.md"] },
    ]);
    if (fused.length !== 2) {
        throw new Error(`应有 2 条，实际 ${fused.length}`);
    }
});

assert("weight 加权生效", () => {
    const fused = fuseRrf([
        { paths: ["x.md", "y.md"], weight: 1 },
        { paths: ["y.md", "x.md"], weight: 2 },
    ]);
    if (fused[0]?.path !== "y.md") {
        throw new Error(`加权后 Top1 应为 y.md，实际 ${fused[0]?.path}`);
    }
});

console.log("\n— sparseScoreToRelevance —");

assert("BM25 > 0 映射到 (0,1)", () => {
    const r = sparseScoreToRelevance(8);
    if (r <= 0 || r >= 1) throw new Error(`expected (0,1), got ${r}`);
});

console.log("\n— hybridRecall（真实语料，不需 Chroma）—");

const runLive = async () => {
    const fromEnv = process.env.FAMBRAIN_CORPUS_USER_ID?.trim();
    const ids = fromEnv ? [fromEnv] : await listCorpusUserIds();
    if (ids.length === 0) {
        console.log("  (skip) 无 corpus 用户");
        return;
    }
    const corpusUserId = ids[0]!;
    const r = await hybridRecall(
        corpusUserId,
        "我的名字是什么",
        "我的名字是什么",
        12
    );
    if (r.recallSource !== "sparse" && r.recallSource !== "hybrid") {
        throw new Error(`Chroma 未起时期望 sparse/hybrid，实际 ${r.recallSource}`);
    }
    if (r.sparseRawCount === 0) {
        throw new Error("sparse 路应至少 1 条");
    }
    if (r.candidates.length === 0) {
        throw new Error("融合后 candidates 不应为空");
    }
    const top = r.candidates[0]!;
    if (!top.recallChannel) {
        throw new Error("candidate 应有 recallChannel");
    }
    console.log(
        `  ✓ hybridRecall corpus=${corpusUserId} source=${r.recallSource} vector=${r.vectorRawCount} sparse=${r.sparseRawCount} top=${top.path}`
    );
};

await runLive().catch((e) => {
    console.error(`  ✗ hybridRecall live: ${e instanceof Error ? e.message : e}`);
    process.exitCode = 1;
});

if (process.exitCode) {
    console.log("\nFAILED");
    process.exit(process.exitCode);
}
console.log("\nOK");
