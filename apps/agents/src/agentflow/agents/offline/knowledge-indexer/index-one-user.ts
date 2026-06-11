import { readFile } from "node:fs/promises";
import path from "node:path";

import type { Logger } from "pino";

import { getUserCorpusRoot, indexCorpusDocuments } from "@/agentflow/knowledge";

import { getEmbedIndexOptions } from "./embed-batches";
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
  const corpusRoot = getUserCorpusRoot(corpusUserId);
  const mdFiles = await listMarkdownFiles(corpusRoot);

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

  const embedOptions = getEmbedIndexOptions();
  logger.info(
    {
      corpusUserId,
      fileCount: mdFiles.length,
      chunkCount: docs.length,
      ...embedOptions,
    },
    "indexing started"
  );

  const { collectionName, chunkCount } = await indexCorpusDocuments(
    corpusUserId,
    docs,
    logger,
    embedOptions
  );

  logger.info(
    {
      corpusUserId,
      collectionName,
      fileCount: mdFiles.length,
      chunkCount,
    },
    "user corpus indexed"
  );

  return { fileCount: mdFiles.length, chunkCount };
}
