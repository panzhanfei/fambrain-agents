/**
 * 知识入库师（KnowledgeIndexer）
 * 离线 CLI：扫描 data/doc/users/corpus → 分块 → LangChain embed → Chroma。
 */

import pino from "pino";

import { indexOneCorpusUser } from "./index-one-user";
import { listCorpusUserIds } from "./list-corpus-users";

export { corpusCollectionName, getChromaServerUrl } from "./constants";
export { indexOneCorpusUser, type IndexOneUserResult } from "./index-one-user";
export { listCorpusUserIds } from "./list-corpus-users";
export { listMarkdownFiles, toRepoPath } from "./list-markdown-files";
export { splitMarkdownToDocuments } from "./split-markdown";

export const indexerLogger = pino({
  name: "fambrain-indexer",
  level: process.env.LOG_LEVEL ?? "info",
});

/** 一次性入库：所有 corpus 下有 md 的用户 */
export async function indexAllCorpora(): Promise<void> {
  const userIds = await listCorpusUserIds();

  if (userIds.length === 0) {
    indexerLogger.warn("no users with corpus markdown under data/doc/users/");
    return;
  }

  indexerLogger.info({ userCount: userIds.length, userIds }, "start index all");

  let totalFiles = 0;
  let totalChunks = 0;

  for (const corpusUserId of userIds) {
    const t0 = Date.now();
    const { fileCount, chunkCount } = await indexOneCorpusUser(
      corpusUserId,
      indexerLogger
    );
    totalFiles += fileCount;
    totalChunks += chunkCount;
    indexerLogger.info(
      { corpusUserId, fileCount, chunkCount, durationMs: Date.now() - t0 },
      "user done"
    );
  }

  indexerLogger.info(
    { userCount: userIds.length, totalFiles, totalChunks },
    "index all completed"
  );
}
