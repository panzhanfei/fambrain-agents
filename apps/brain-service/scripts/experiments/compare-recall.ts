/**
 * Recall vector / BM25 sparse / RRF hybrid 三路对比（HY-07 实验脚本）。
 *
 *   pnpm run experiment:recall-compare -- <corpusUserId> "<query>"
 *
 * 需 Ollama embed + Chroma 已入库。
 */
import { recallSparseRetrieve, searchCorpusVectors } from "@fambrain/corpus";
import { hybridRecall } from "../src/agentflow/brain-service/online/knowledge-manager/recall/hybrid-recall";

const printHits = (
    label: string,
    hits: { path: string; title: string; score?: number; fusionScore?: number }[],
    extra?: string
) => {
    console.log(`\n=== ${label} (${hits.length})${extra ? ` ${extra}` : ""} ===`);
    for (const [i, h] of hits.entries()) {
        const parts: string[] = [];
        if (typeof h.score === "number") parts.push(`dist=${h.score.toFixed(3)}`);
        if (typeof h.fusionScore === "number")
            parts.push(`rrf=${h.fusionScore.toFixed(4)}`);
        const score = parts.length ? ` ${parts.join(" ")}` : "";
        console.log(`${i + 1}. ${h.path}${score}`);
        console.log(`   ${h.title}`);
    }
};

const main = async () => {
    const corpusUserId = process.argv[2]?.trim();
    const query = process.argv.slice(3).join(" ").trim();
    if (!corpusUserId || !query) {
        console.error(
            'Usage: pnpm run experiment:recall-compare -- <corpusUserId> "<query>"'
        );
        process.exit(1);
    }
    console.log(`corpusUserId=${corpusUserId}`);
    console.log(`query=${query}`);

    let vectorHits: Awaited<ReturnType<typeof searchCorpusVectors>> = [];
    try {
        vectorHits = await searchCorpusVectors(corpusUserId, query, 8);
    } catch (e) {
        console.error(
            "vector 失败（Chroma/Ollama 未就绪？）:",
            e instanceof Error ? e.message : e
        );
    }

    const sparseHits = await recallSparseRetrieve(corpusUserId, query, 8);
    const hybrid = await hybridRecall(corpusUserId, query, query, 8);

    printHits(
        "Chroma vector",
        vectorHits.map((h) => ({ path: h.path, title: h.title, score: h.score }))
    );
    printHits(
        "BM25 sparse",
        sparseHits.map((h) => ({
            path: h.path,
            title: h.title,
            score: h.score,
        }))
    );
    printHits(
        "RRF hybrid",
        hybrid.candidates.map((h) => ({
            path: h.path,
            title: h.title,
            score: h.score,
            fusionScore: h.fusionScore,
        })),
        `source=${hybrid.recallSource}`
    );

    const paths = (list: { path: string }[]) => new Set(list.map((h) => h.path));
    const v = paths(vectorHits);
    const s = paths(sparseHits);
    const h = paths(hybrid.candidates);
    const overlapVs = [...v].filter((p) => s.has(p));
    const overlapH = [...h].filter((p) => v.has(p) || s.has(p));
    console.log(`\nvector ∩ sparse: ${overlapVs.length}`);
    console.log(`RRF top8 ∩ (vector∪sparse): ${overlapH.length}/${h.size}`);
};

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
