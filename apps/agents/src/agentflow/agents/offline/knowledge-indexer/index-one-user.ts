import { readFile } from "node:fs/promises";
import path from "node:path";

import { Chroma } from "@langchain/community/vectorstores/chroma";
import type { Logger } from "pino";

import {
  chromaLibArgs,
  createOllamaEmbeddings,
  deleteChromaCollection,
  getUserCorpusRoot,
} from "@/agentflow/knowledge";

import { corpusCollectionName } from "./constants";
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
  // ① 扫描 md
  const corpusRoot = getUserCorpusRoot(corpusUserId);
  const mdFiles = await listMarkdownFiles(corpusRoot);

  // ② 读文件 + 分块
  const docs = [];
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
  const embeddings = createOllamaEmbeddings();

  // ③ 全量重建：删旧 collection（首次不存在则忽略）
  await deleteChromaCollection(collectionName);
  logger.info({ corpusUserId, collectionName }, "deleted old collection");

  // ④ embed + 写入（内部会调 Ollama，可能较慢）
  logger.info(
    { corpusUserId, fileCount: mdFiles.length, chunkCount: docs.length },
    "indexing started"
  );

  const vectorStore = new Chroma(embeddings, chromaLibArgs(collectionName));
  await vectorStore.addDocuments(docs, {
    ids: docs.map((doc) => doc.id ?? ""),
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
