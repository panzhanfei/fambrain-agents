/**
 * HY-02：向量 ∥ BM25 sparse 并行召回 → HY-03 RRF 融合。
 */
import { recallSparseRetrieve, searchCorpusVectors } from "@fambrain/corpus";
import {
    RRF_K,
    RRF_SPARSE_WEIGHT,
    RRF_VECTOR_WEIGHT,
    VECTOR_FETCH_MULTIPLIER,
} from "../profile/km-config";
import { fuseRrf } from "./fusion-rrf";
import { dedupeVectorByPath, mergeChunkBodies } from "./retrieve-helpers";
import type { KnowledgeCandidate, RecallChannel, RecallSource } from "../contract/types";

export type HybridRecallResult = {
    candidates: KnowledgeCandidate[];
    recallSource: RecallSource;
    vectorRawCount: number;
    sparseRawCount: number;
    uniquePathCount: number;
};

/** 向量路常见噪声（README/模板），不参与 RRF 排名。 */
const isVectorNoisePath = (repoPath: string): boolean => {
    const p = repoPath.replace(/\\/g, "/").toLowerCase();
    if (p.endsWith("/readme.md")) return true;
    if (p.includes("/_template.md")) return true;
    return false;
};

const mergeHybridCandidates = (
    vectorRows: KnowledgeCandidate[],
    sparseRows: KnowledgeCandidate[],
    fusionOrder: { path: string; fusionScore: number }[],
    maxCandidates: number
): KnowledgeCandidate[] => {
    const byPath = new Map<string, KnowledgeCandidate>();

    for (const row of [...vectorRows, ...sparseRows]) {
        const existing = byPath.get(row.path);
        if (!existing) {
            byPath.set(row.path, { ...row });
            continue;
        }
        const mergedBody = mergeChunkBodies([existing.body, row.body]);
        const channels = new Set<RecallChannel>([
            existing.recallChannel ?? "vector",
            row.recallChannel ?? "sparse",
        ]);
        const recallChannel: RecallChannel =
            channels.has("vector") && channels.has("sparse")
                ? "hybrid"
                : channels.has("vector")
                  ? "vector"
                  : "sparse";
        byPath.set(row.path, {
            path: row.path,
            title: existing.title || row.title,
            body: mergedBody,
            score: existing.score ?? row.score,
            rawScore: Math.max(existing.rawScore ?? 0, row.rawScore ?? 0),
            recallChannel,
        });
    }

    const fusionScoreByPath = new Map(
        fusionOrder.map(({ path, fusionScore }) => [path, fusionScore])
    );

    const fused: KnowledgeCandidate[] = [];
    const seen = new Set<string>();
    const pushFused = (path: string) => {
        if (seen.has(path)) return;
        const row = byPath.get(path);
        if (!row) return;
        seen.add(path);
        fused.push({ ...row, fusionScore: fusionScoreByPath.get(path) });
    };

    // 各路 Top1 先入池，避免 RRF 截断丢掉 sparse/vector 最佳字面或语义命中
    for (const pin of [sparseRows[0]?.path, vectorRows[0]?.path]) {
        if (pin) pushFused(pin);
    }
    for (const { path } of fusionOrder) {
        pushFused(path);
        if (fused.length >= maxCandidates) break;
    }
    return fused.slice(0, maxCandidates);
};

export const hybridRecall = async (
    corpusUserId: string,
    vectorQuery: string,
    sparseQuery: string,
    vectorTopK: number
): Promise<HybridRecallResult> => {
    const vectorFetchK = Math.ceil(vectorTopK * VECTOR_FETCH_MULTIPLIER);

    let vectorRaw: KnowledgeCandidate[] = [];
    let vectorRawCount = 0;
    try {
        const vectorHits = await searchCorpusVectors(
            corpusUserId,
            vectorQuery,
            vectorFetchK
        );
        vectorRawCount = vectorHits.length;
        vectorRaw = dedupeVectorByPath(
            vectorHits
                .filter((h) => !isVectorNoisePath(h.path))
                .map((h) => ({
                path: h.path,
                title: h.title,
                body: h.body,
                score: h.score,
                rawScore: h.score,
                recallChannel: "vector" as const,
            })),
            undefined,
            vectorFetchK
        );
    } catch {
        vectorRaw = [];
    }

    const sparseHits = await recallSparseRetrieve(
        corpusUserId,
        sparseQuery,
        vectorFetchK
    );
    const sparseRaw: KnowledgeCandidate[] = sparseHits.map((h) => ({
        path: h.path,
        title: h.title,
        body: h.body,
        rawScore: h.score,
        recallChannel: "sparse" as const,
    }));

    const fusionOrder = fuseRrf(
        [
            { paths: vectorRaw.map((c) => c.path), weight: RRF_VECTOR_WEIGHT },
            { paths: sparseRaw.map((c) => c.path), weight: RRF_SPARSE_WEIGHT },
        ],
        RRF_K
    );

    const candidates = mergeHybridCandidates(
        vectorRaw,
        sparseRaw,
        fusionOrder,
        vectorTopK
    );

    let recallSource: RecallSource = "empty";
    if (vectorRaw.length > 0 && sparseRaw.length > 0) {
        recallSource = "hybrid";
    } else if (vectorRaw.length > 0) {
        recallSource = "vector";
    } else if (sparseRaw.length > 0) {
        recallSource = "sparse";
    }

    return {
        candidates,
        recallSource,
        vectorRawCount,
        sparseRawCount: sparseRaw.length,
        uniquePathCount: new Set(candidates.map((c) => c.path)).size,
    };
};
