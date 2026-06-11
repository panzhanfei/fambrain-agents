import type { Document } from "@langchain/core/documents";
import { Chroma } from "@langchain/community/vectorstores/chroma";
import { OllamaEmbeddings } from "@langchain/ollama";
import { ChromaClient } from "chromadb";
import type { Logger } from "pino";

import { getAgentsConfig } from "@fambrain/agent-config";
import { resolveChromaServerUrl } from "@fambrain/agent-config/service-url";

import {
  addDocumentsWithEmbedLimit,
  getEmbedIndexOptions,
  type EmbedIndexOptions,
} from "./embed-batches";

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

/** 每个 corpusUserId 对应一个 Chroma collection */
export function corpusCollectionName(corpusUserId: string): string {
  return `fambrain_corpus_${corpusUserId}`;
}

/** 读取 `.env`：优先 `CHROMA_SERVER_URL`，否则 `CHROMA_HOST` + `CHROMA_PORT` */
export function getChromaServerUrl(): string {
  return resolveChromaServerUrl();
}

export function createOllamaEmbeddings(): OllamaEmbeddings {
  const { ollama } = getAgentsConfig();
  return new OllamaEmbeddings({
    model: ollama.models.embed,
    baseUrl: ollama.baseUrl,
  });
}

export function chromaLibArgs(collectionName: string) {
  return {
    url: getChromaServerUrl(),
    collectionName,
  };
}

export async function deleteChromaCollection(collectionName: string): Promise<void> {
  const client = new ChromaClient({ path: getChromaServerUrl() });
  try {
    await client.deleteCollection({ name: collectionName });
  } catch {
    // 首次入库，collection 不存在
  }
}

/** 连接已有 collection（在线检索用） */
export async function openCorpusVectorStore(collectionName: string): Promise<Chroma> {
  return Chroma.fromExistingCollection(
    createOllamaEmbeddings(),
    chromaLibArgs(collectionName)
  );
}

/**
 * 在线语义召回：embed 查询句 → Chroma 相似度 TopK。
 * 数据由离线 `indexCorpusDocuments` 写入，读写共用本模块的 embed 模型与 collection 命名。
 */
export async function searchCorpusVectors(
  corpusUserId: string,
  searchQuery: string,
  topK = 12
): Promise<CorpusVectorHit[]> {
  const collectionName = corpusCollectionName(corpusUserId);
  const vectorStore = await openCorpusVectorStore(collectionName);

  const results = await vectorStore.similaritySearchWithScore(searchQuery, topK);

  return results.map(([doc, score]) => ({
    path: String(doc.metadata.path ?? ""),
    title: String(doc.metadata.title ?? ""),
    body: doc.pageContent,
    score,
  }));
}

/**
 * 离线索引写入：删旧 collection → 分批 embed → 写入 Chroma。
 * 全量幂等，与在线 `searchCorpusVectors` 使用同一套配置。
 */
export async function indexCorpusDocuments(
  corpusUserId: string,
  docs: Document[],
  logger: Logger,
  options: EmbedIndexOptions = getEmbedIndexOptions()
): Promise<CorpusVectorIndexResult> {
  const collectionName = corpusCollectionName(corpusUserId);

  await deleteChromaCollection(collectionName);
  logger.info({ corpusUserId, collectionName }, "deleted old collection");

  if (docs.length === 0) {
    return { collectionName, chunkCount: 0 };
  }

  const vectorStore = new Chroma(createOllamaEmbeddings(), chromaLibArgs(collectionName));
  await addDocumentsWithEmbedLimit(vectorStore, docs, logger, options);

  return { collectionName, chunkCount: docs.length };
}
