/**
 * 知识入库师（KnowledgeIndexer）
 * 离线 CLI：扫描 data/doc/users/corpus → 分块 → LangChain embed → Chroma。
 */
import pino from "pino";
import { getChromaServerUrl } from "./constants";
import { indexOneCorpusUser } from "./index-one-user";
import { logIndexerIn, logIndexerOut, logIndexerStep } from "./indexer-log";
import { listCorpusUserIds } from "./list-corpus-users";
import { getEmbedIndexOptions } from "./embed-batches";
export { corpusCollectionName, getChromaServerUrl } from "./constants";
export { addDocumentsWithEmbedLimit, getEmbedIndexOptions, type EmbedIndexOptions, } from "./embed-batches";
export { indexOneCorpusUser, type IndexOneUserResult } from "./index-one-user";
export { listCorpusUserIds } from "./list-corpus-users";
export { listMarkdownFiles, toRepoPath } from "@fambrain/corpus";
export { splitMarkdownToDocuments } from "./split-markdown";
export const indexerLogger = pino({
    name: "fambrain-indexer",
    level: process.env.LOG_LEVEL ?? "info",
});
export const indexAllCorpora = async (): Promise<void> => {
    const tAll = Date.now();
    const embedOptions = getEmbedIndexOptions();
    logIndexerIn("全量入库开始", {
        chromaUrl: getChromaServerUrl(),
        embedOptions,
        logLevel: process.env.LOG_LEVEL ?? "info",
        hint: "每 Agent 仅 📥进入 / 📤出去；结构化 JSON 来自 pino（fambrain-indexer）",
    });
    const userIds = await listCorpusUserIds();
    if (userIds.length === 0) {
        logIndexerOut("全量入库结束", { userCount: 0, reason: "data/doc/users/ 下无 corpus markdown" });
        indexerLogger.warn("no users with corpus markdown under data/doc/users/");
        return;
    }
    logIndexerStep("1/4 发现待入库用户", { userCount: userIds.length, userIds });
    indexerLogger.info({ userCount: userIds.length, userIds }, "start index all");
    let totalFiles = 0;
    let totalChunks = 0;
    for (let i = 0; i < userIds.length; i++) {
        const corpusUserId = userIds[i]!;
        logIndexerStep(`2/4 开始用户 ${i + 1}/${userIds.length}`, { corpusUserId });
        const t0 = Date.now();
        const { fileCount, chunkCount } = await indexOneCorpusUser(corpusUserId, indexerLogger);
        totalFiles += fileCount;
        totalChunks += chunkCount;
        const userSummary = { corpusUserId, fileCount, chunkCount, durationMs: Date.now() - t0 };
        logIndexerStep(`2/4 用户完成 ${i + 1}/${userIds.length}`, userSummary);
        indexerLogger.info(userSummary, "user done");
    }
    const summary = {
        userCount: userIds.length,
        totalFiles,
        totalChunks,
        durationMs: Date.now() - tAll,
    };
    logIndexerOut("全量入库完成", summary);
    indexerLogger.info(summary, "index all completed");
};
