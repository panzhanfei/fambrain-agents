import pLimit from "p-limit";
import type { Logger } from "pino";
import { indexOneCorpusUser } from "@/agentflow/agents/offline/knowledge-indexer";
import type { CorpusCategory } from "@/agentflow/knowledge";
import { docParserLogger } from "./logger";
import { buildOutputPaths, parseDocumentBuffer, } from "./parse-file";
import { docParseBatchResultSchema, docParseFileResultSchema, type DocParseBatchResult, type DocParseFileResult, } from "./schema";
import { detectDocFormat, isSupportedDocFile } from "./supported-formats";
import { saveOriginalToVault, writeParsedToCorpus } from "./write-corpus-md";
export type UploadFileInput = {
    fileName: string;
    buffer: Buffer;
};
export type IngestBatchOptions = {
    actorUserId: string;
    corpusUserId: string;
    category: CorpusCategory;
    indexAfter?: boolean;
    logger?: Logger;
};
const clampInt = (raw: string | undefined, fallback: number, max: number): number => {
    if (raw === undefined || raw.trim() === "")
        return fallback;
    const n = Number(raw);
    if (!Number.isFinite(n))
        return fallback;
    return Math.min(max, Math.max(1, Math.round(n)));
};
export const getDocParseConcurrency = (): number => {
    return clampInt(process.env.DOC_PARSE_CONCURRENCY, 2, 8);
};
const ingestOneFile = async (input: UploadFileInput, options: IngestBatchOptions): Promise<DocParseFileResult> => {
    const { fileName, buffer } = input;
    const { actorUserId, corpusUserId, category } = options;
    if (!isSupportedDocFile(fileName)) {
        return docParseFileResultSchema.parse({
            fileName,
            ok: false,
            format: "unsupported",
            error: `不支持的文件类型：${fileName}`,
        });
    }
    try {
        const { vaultRelativePath, corpusRelativePath, mdFileName } = buildOutputPaths(actorUserId, corpusUserId, category, fileName);
        await saveOriginalToVault(actorUserId, fileName, buffer);
        const parsed = await parseDocumentBuffer(buffer, fileName, {
            vaultRelativePath,
            corpusRelativePath,
        });
        const writtenPath = await writeParsedToCorpus(corpusUserId, category, mdFileName, parsed);
        return docParseFileResultSchema.parse({
            fileName,
            ok: true,
            format: detectDocFormat(fileName),
            vaultRelativePath,
            corpusRelativePath: writtenPath,
            title: parsed.title,
            textLength: parsed.text.length,
        });
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return docParseFileResultSchema.parse({
            fileName,
            ok: false,
            format: detectDocFormat(fileName),
            error: msg,
        });
    }
};
export const ingestDocumentBatch = async (files: UploadFileInput[], options: IngestBatchOptions): Promise<DocParseBatchResult> => {
    const { actorUserId, corpusUserId, category, indexAfter = true, logger } = options;
    if (files.length === 0) {
        throw new Error("至少上传 1 个文件");
    }
    const limit = pLimit(getDocParseConcurrency());
    logger?.info({
        fileCount: files.length,
        actorUserId,
        corpusUserId,
        category,
        concurrency: getDocParseConcurrency(),
    }, "doc parse batch started");
    const results = await Promise.all(files.map((file) => limit(() => ingestOneFile(file, options))));
    const successCount = results.filter((r) => r.ok).length;
    logger?.info({ successCount, total: results.length }, "doc parse batch files done");
    let indexResult: {
        fileCount: number;
        chunkCount: number;
    } | undefined;
    let indexed = false;
    if (indexAfter && successCount > 0) {
        const indexLogger = logger ?? docParserLogger;
        indexResult = await indexOneCorpusUser(corpusUserId, indexLogger);
        indexed = true;
        indexLogger.info({ corpusUserId, ...indexResult }, "doc parse batch indexed");
    }
    return docParseBatchResultSchema.parse({
        corpusUserId,
        actorUserId,
        category,
        indexed,
        indexResult,
        files: results,
    });
};
