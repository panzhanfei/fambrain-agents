/**
 * embed 分批 + p-limit 逻辑单测（不依赖 Ollama / Chroma）。
 *
 *   pnpm run verify:embed-batches
 */
import assert from "node:assert/strict";
import { getEmbedIndexOptions } from "../src/agentflow/agents/offline/knowledge-indexer/embed-batches.ts";
const testDefaults = () => {
    const prev = {
        c: process.env.INDEX_EMBED_CONCURRENCY,
        b: process.env.INDEX_EMBED_BATCH_SIZE,
    };
    delete process.env.INDEX_EMBED_CONCURRENCY;
    delete process.env.INDEX_EMBED_BATCH_SIZE;
    const opts = getEmbedIndexOptions();
    assert.equal(opts.concurrency, 3);
    assert.equal(opts.batchSize, 8);
    process.env.INDEX_EMBED_CONCURRENCY = prev.c;
    process.env.INDEX_EMBED_BATCH_SIZE = prev.b;
};
const testEnvClamp = () => {
    const prev = {
        c: process.env.INDEX_EMBED_CONCURRENCY,
        b: process.env.INDEX_EMBED_BATCH_SIZE,
    };
    process.env.INDEX_EMBED_CONCURRENCY = "99";
    process.env.INDEX_EMBED_BATCH_SIZE = "0";
    const opts = getEmbedIndexOptions();
    assert.equal(opts.concurrency, 16);
    assert.equal(opts.batchSize, 1);
    process.env.INDEX_EMBED_CONCURRENCY = prev.c;
    process.env.INDEX_EMBED_BATCH_SIZE = prev.b;
};
const main = () => {
    testDefaults();
    testEnvClamp();
    console.log("embed-batches 单测通过。");
};
main();
