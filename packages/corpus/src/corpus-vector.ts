import type { Document } from "@langchain/core/documents";
import { Chroma } from "@langchain/community/vectorstores/chroma";
import { OllamaEmbeddings } from "@langchain/ollama";
import { ChromaClient } from "chromadb";
import type { Logger } from "pino";
import { getBrainServiceConfig } from "@fambrain/brain-config";
import { resolveChromaServerUrl } from "@fambrain/brain-config/service-url";
import { addDocumentsWithEmbedLimit, getEmbedIndexOptions, type EmbedIndexOptions, } from "./embed-batches";
/** 在线向量召回单条结果（与 KnowledgeManager candidates 对齐） */
export type CorpusVectorHit = {
    path: string;
    title: string;
    body: string;
    score: number;
};
export type CorpusVectorIndexResult = {
    collectionName: string;
    chunkCount: number;
};
export const corpusCollectionName = (corpusUserId: string): string => {
    return `fambrain_corpus_${corpusUserId}`;
};
export const getChromaServerUrl = (): string => {
    return resolveChromaServerUrl();
};
export const createOllamaEmbeddings = (): OllamaEmbeddings => {
    const { ollama } = getBrainServiceConfig();
    return new OllamaEmbeddings({
        model: ollama.models.embed,
        baseUrl: ollama.baseUrl,
    });
};
export const chromaLibArgs = (collectionName: string) => {
    return {
        url: getChromaServerUrl(),
        collectionName,
    };
};
export const deleteChromaCollection = async (collectionName: string): Promise<void> => {
    const client = new ChromaClient({ path: getChromaServerUrl() });
    try {
        await client.deleteCollection({ name: collectionName });
    }
    catch {
        // 首次入库，collection 不存在
    }
};
export const openCorpusVectorStore = async (collectionName: string): Promise<Chroma> => {
    return Chroma.fromExistingCollection(createOllamaEmbeddings(), chromaLibArgs(collectionName));
};
export const searchCorpusVectors = async (corpusUserId: string, searchQuery: string, topK = 12): Promise<CorpusVectorHit[]> => {
    const collectionName = corpusCollectionName(corpusUserId);
    const vectorStore = await openCorpusVectorStore(collectionName);
    const results = await vectorStore.similaritySearchWithScore(searchQuery, topK);
    return results.map(([doc, score]) => ({
        path: String(doc.metadata.path ?? ""),
        title: String(doc.metadata.title ?? ""),
        body: doc.pageContent,
        score,
    }));
};
export const indexCorpusDocuments = async (corpusUserId: string, docs: Document[], logger: Logger, options: EmbedIndexOptions = getEmbedIndexOptions()): Promise<CorpusVectorIndexResult> => {
    const collectionName = corpusCollectionName(corpusUserId);
    const chromaUrl = getChromaServerUrl();
    const { ollama } = getBrainServiceConfig();
    logger.info({
        step: "4a",
        corpusUserId,
        collectionName,
        chromaUrl,
        embedModel: ollama.models.embed,
        ollamaBaseUrl: ollama.baseUrl,
        chunkCount: docs.length,
    }, "corpus index: config");
    const tDel = Date.now();
    await deleteChromaCollection(collectionName);
    logger.info({
        step: "4b",
        corpusUserId,
        collectionName,
        durationMs: Date.now() - tDel,
    }, "corpus index: deleted old collection (full rebuild)");
    if (docs.length === 0) {
        return { collectionName, chunkCount: 0 };
    }
    const tStore = Date.now();
    const vectorStore = new Chroma(createOllamaEmbeddings(), chromaLibArgs(collectionName));
    logger.info({
        step: "4c",
        corpusUserId,
        collectionName,
        durationMs: Date.now() - tStore,
    }, "corpus index: chroma vector store ready");
    await addDocumentsWithEmbedLimit(vectorStore, docs, logger, options);
    logger.info({
        step: "4d",
        corpusUserId,
        collectionName,
        chunkCount: docs.length,
    }, "corpus index: all chunks embedded and stored");
    return { collectionName, chunkCount: docs.length };
};
