import { readFile } from "node:fs/promises";
import path from "node:path";

import { ChromaVectorStore } from "@llamaindex/chroma";
import { OllamaEmbedding } from "@llamaindex/ollama";
import { Document, Settings, VectorStoreIndex, storageContextFromDefaults } from "llamaindex";
import type { Logger } from "pino";

import { getAgentsConfig } from "@fambrain/agent-config";
import { getUserCorpusRoot } from "../knowledge/doc-paths";

import { corpusCollectionName, getChromaServerUrl } from "./constants";
import { listMarkdownFiles, toRepoPath } from "./list-markdown-files";
import { splitMarkdownToDocuments } from "./split-markdown";

export type IndexOneUserResult = {
  fileCount: number;
  chunkCount: number;
};

export async function indexOneCorpusUser(
  corpusUserId: string,
  logger: Logger
): Promise<IndexOneUserResult> {
  const { ollama } = getAgentsConfig();

  // ① 配置 embedding 模型（读 .env 的 OLLAMA_BASE_URL / OLLAMA_MODEL_EMBED）
  Settings.embedModel = new OllamaEmbedding({
    model: ollama.models.embed,
    config: { host: ollama.baseUrl },
  });

  // ② 扫描 md
  const corpusRoot = getUserCorpusRoot(corpusUserId);
  const mdFiles = await listMarkdownFiles(corpusRoot);

  // ③ 读文件 + 分块
  const docs: Document[] = [];
  for (const absPath of mdFiles) {
    const body = await readFile(absPath, "utf8");
    const repoPath = toRepoPath(absPath);
    const fileName = path.basename(absPath);
    docs.push(
      ...splitMarkdownToDocuments(corpusUserId, repoPath, body, fileName)
    );
  }

  if (docs.length === 0) {
    logger.warn({ corpusUserId }, "no markdown chunks, skip");
    return { fileCount: 0, chunkCount: 0 };
  }

  const collectionName = corpusCollectionName(corpusUserId);

  // ④ Chroma 存储（JS client 连 HTTP 服务，见 getChromaServerUrl / CHROMA_DATA_PATH）
  const vectorStore = new ChromaVectorStore({
    collectionName,
    chromaClientParams: { path: getChromaServerUrl() },
  });

  // ⑤ 全量重建：删旧 collection（首次不存在则忽略）
  const client = vectorStore.client();
  try {
    await client.deleteCollection({ name: collectionName });
    logger.info({ corpusUserId, collectionName }, "deleted old collection");
  } catch {
    // 首次入库，collection 不存在
  }

  // ⑥ embed + 写入（内部会调 Ollama，可能较慢）
  logger.info(
    { corpusUserId, fileCount: mdFiles.length, chunkCount: docs.length },
    "indexing started"
  );

  const storageContext = await storageContextFromDefaults({
    vectorStore,
  });

  await VectorStoreIndex.fromDocuments(docs, {
    storageContext,
  });

  logger.info(
    {
      corpusUserId,
      collectionName,
      fileCount: mdFiles.length,
      chunkCount: docs.length,
    },
    "user corpus indexed"
  );

  return { fileCount: mdFiles.length, chunkCount: docs.length };
}
