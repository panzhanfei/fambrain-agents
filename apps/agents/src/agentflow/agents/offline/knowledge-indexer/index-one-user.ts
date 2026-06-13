import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Logger } from "pino";
import {
  getUserCorpusRoot,
  indexCorpusDocuments,
  listMarkdownFiles,
  toRepoPath,
} from "@fambrain/corpus";
import { corpusCollectionName, getChromaServerUrl } from "./constants";
import { getEmbedIndexOptions } from "./embed-batches";
import { logIndexerIn, logIndexerOut, logIndexerStep } from "./indexer-log";
import { splitMarkdownToDocuments } from "./split-markdown";
export type IndexOneUserResult = {
    fileCount: number;
    chunkCount: number;
};
export const indexOneCorpusUser = async (corpusUserId: string, logger: Logger): Promise<IndexOneUserResult> => {
    const corpusRoot = getUserCorpusRoot(corpusUserId);
    const collectionName = corpusCollectionName(corpusUserId);
    logIndexerIn(`单用户入库 corpusUserId=${corpusUserId}`, {
        corpusRoot,
        collectionName,
        chromaUrl: getChromaServerUrl(),
    });
    logIndexerStep("3a 递归扫描 .md", { corpusRoot });
    const mdFiles = await listMarkdownFiles(corpusRoot);
    logIndexerStep("3b 扫描结果", {
        mdFileCount: mdFiles.length,
        paths: mdFiles.map((f) => toRepoPath(f)),
    });
    const docs = [];
    const fileSplits: Array<{
        path: string;
        title: string;
        chunkCount: number;
        chunkIds: string[];
        splitMode: "whole" | "by-h2" | "empty";
    }> = [];
    for (const absPath of mdFiles) {
        const body = await readFile(absPath, "utf8");
        const repoPath = toRepoPath(absPath);
        const fileName = path.basename(absPath);
        const fileDocs = splitMarkdownToDocuments(corpusUserId, repoPath, body, fileName);
        if (fileDocs.length === 0) {
            fileSplits.push({
                path: repoPath,
                title: fileName,
                chunkCount: 0,
                chunkIds: [],
                splitMode: "empty",
            });
            continue;
        }
        const title = String(fileDocs[0]?.metadata.title ?? fileName);
        const splitMode = fileDocs.length === 1 && !body.includes("\n## ")
            ? "whole"
            : "by-h2";
        fileSplits.push({
            path: repoPath,
            title,
            chunkCount: fileDocs.length,
            chunkIds: fileDocs.map((d) => d.id ?? ""),
            splitMode,
        });
        docs.push(...fileDocs);
    }
    logIndexerStep("3c 分块汇总", {
        fileCount: mdFiles.length,
        totalChunks: docs.length,
        files: fileSplits,
    });
    if (docs.length === 0) {
        logIndexerOut(`单用户跳过 corpusUserId=${corpusUserId}`, { reason: "no markdown chunks" });
        logger.warn({ corpusUserId }, "no markdown chunks, skip");
        return { fileCount: 0, chunkCount: 0 };
    }
    const embedOptions = getEmbedIndexOptions();
    logIndexerStep("3d 准备 embed + 写 Chroma", {
        corpusUserId,
        collectionName,
        fileCount: mdFiles.length,
        chunkCount: docs.length,
        ...embedOptions,
        sampleChunk: {
            id: docs[0]?.id,
            path: docs[0]?.metadata.path,
            title: docs[0]?.metadata.title,
            contentPreview: docs[0]?.pageContent.slice(0, 120),
        },
    });
    logger.info({
        corpusUserId,
        fileCount: mdFiles.length,
        chunkCount: docs.length,
        ...embedOptions,
    }, "indexing started");
    const tIndex = Date.now();
    const { collectionName: indexedCollection, chunkCount } = await indexCorpusDocuments(corpusUserId, docs, logger, embedOptions);
    const result = {
        corpusUserId,
        collectionName: indexedCollection,
        fileCount: mdFiles.length,
        chunkCount,
        indexDurationMs: Date.now() - tIndex,
    };
    logIndexerOut(`单用户入库完成 corpusUserId=${corpusUserId}`, result);
    logger.info(result, "user corpus indexed");
    return { fileCount: mdFiles.length, chunkCount };
};
