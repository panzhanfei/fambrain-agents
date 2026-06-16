import {
    MAX_CANDIDATES,
    MAX_CHUNKS_PER_PATH,
    MERGED_CHUNK_BODY_MAX,
} from "./km-config";

/** 与 retrieve.ts CandidateRow 对齐 */
export type VectorChunkRow = {
    path: string;
    title: string;
    body: string;
    score?: number;
};

/**
 * KM-02：向量按 chunk 召回时，同一 md path 会出现多次。
 * 按 path 分组，每文件最多保留 MAX_CHUNKS_PER_PATH 段（L2 最优），多段则合并 body。
 */
export const dedupeVectorByPath = (
    chunks: VectorChunkRow[],
    maxPerPath = MAX_CHUNKS_PER_PATH
): VectorChunkRow[] => {
    const byPath = new Map<string, VectorChunkRow[]>();
    for (const c of chunks) {
        const list = byPath.get(c.path) ?? [];
        list.push(c);
        byPath.set(c.path, list);
    }

    const merged: VectorChunkRow[] = [];
    for (const group of byPath.values()) {
        const sorted = [...group].sort(
            (a, b) =>
                (a.score ?? Number.POSITIVE_INFINITY) -
                (b.score ?? Number.POSITIVE_INFINITY)
        );
        const kept = sorted.slice(0, maxPerPath);
        const best = kept[0]!;
        if (kept.length === 1) {
            merged.push(best);
            continue;
        }
        merged.push({
            path: best.path,
            title: best.title,
            body: kept
                .map((k) => k.body)
                .join("\n\n---\n\n")
                .slice(0, MERGED_CHUNK_BODY_MAX),
            score: best.score,
        });
    }

    return merged
        .sort(
            (a, b) =>
                (a.score ?? Number.POSITIVE_INFINITY) -
                (b.score ?? Number.POSITIVE_INFINITY)
        )
        .slice(0, MAX_CANDIDATES);
};
