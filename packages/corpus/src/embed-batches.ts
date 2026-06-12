import type { Document } from "@langchain/core/documents";
import { Chroma } from "@langchain/community/vectorstores/chroma";
import pLimit from "p-limit";
import type { Logger } from "pino";
const clampInt = (raw: string | undefined, fallback: number, max: number): number => {
    if (raw === undefined || raw.trim() === "")
        return fallback;
    const n = Number(raw);
    if (!Number.isFinite(n))
        return fallback;
    return Math.min(max, Math.max(1, Math.round(n)));
};
export type EmbedIndexOptions = {
    concurrency: number;
    batchSize: number;
};
export const getEmbedIndexOptions = (): EmbedIndexOptions => {
    return {
        concurrency: clampInt(process.env.INDEX_EMBED_CONCURRENCY, 3, 16),
        batchSize: clampInt(process.env.INDEX_EMBED_BATCH_SIZE, 8, 64),
    };
};
const chunkDocuments = <T>(items: T[], size: number): T[][] => {
    const batches: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
        batches.push(items.slice(i, i + size));
    }
    return batches;
};
export const addDocumentsWithEmbedLimit = async (vectorStore: Chroma, docs: Document[], logger: Logger, options: EmbedIndexOptions = getEmbedIndexOptions()): Promise<void> => {
    if (docs.length === 0)
        return;
    const { concurrency, batchSize } = options;
    const batches = chunkDocuments(docs, batchSize);
    const limit = pLimit(concurrency);
    logger.info({ chunkCount: docs.length, batchCount: batches.length, concurrency, batchSize }, "embed batches scheduled");
    let indexed = 0;
    await Promise.all(batches.map((batch, batchIndex) => limit(async () => {
        await vectorStore.addDocuments(batch, {
            ids: batch.map((doc) => doc.id ?? ""),
        });
        indexed += batch.length;
        logger.info({
            batchIndex: batchIndex + 1,
            batchCount: batches.length,
            batchSize: batch.length,
            indexed,
            total: docs.length,
        }, "embed batch done");
    })));
};
