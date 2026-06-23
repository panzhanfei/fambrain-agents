import pLimit from "p-limit";
import type { Logger } from "pino";
import { indexOneCorpusUser } from "@/agentflow/agents/offline/knowledge-indexer";
import type { CorpusCategory } from "@fambrain/corpus";
import { ensureCorpusUserLayout } from "./ensure-corpus-layout";
import { docParserLogger } from "./logger";
import { buildOutputPaths, parseDocumentContent } from "./parse-file";
import {
    docParseBatchResultSchema,
    docParseCategorySummarySchema,
    docParseFileResultSchema,
    type DocParseBatchResult,
    type DocParseCategorySummary,
    type DocParseFileResult,
} from "./schema";
import { resolveCorpusCategory } from "./resolve-corpus-category";
import { detectDocFormat, isSupportedDocFile } from "./supported-formats";
import { saveOriginalToVault, writeParsedToCorpus } from "./write-corpus-md";
export type UploadFileInput = {
    fileName: string;
    buffer: Buffer;
    /** 上传时的相对路径（如 webkitRelativePath），用于路径分类。 */
    relativePath?: string;
};
export type IngestBatchOptions = {
    actorUserId: string;
    corpusUserId: string;
    /** 整批强制分类；省略则按文件自动推断。 */
    category?: CorpusCategory;
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
const emptyCategorySummary = (): DocParseCategorySummary => ({
    personal: 0,
    projects: 0,
    experience: 0,
});
const bumpCategorySummary = (summary: DocParseCategorySummary, category: CorpusCategory): void => {
    summary[category] += 1;
};
const ingestOneFile = async (input: UploadFileInput, options: IngestBatchOptions): Promise<DocParseFileResult> => {
    const { fileName, buffer, relativePath } = input;
    const { actorUserId, corpusUserId, category: forcedCategory } = options;
    if (!isSupportedDocFile(fileName)) {
        return docParseFileResultSchema.parse({
            fileName,
            ok: false,
            format: "unsupported",
            error: `不支持的文件类型：${fileName}`,
        });
    }
    try {
        const vaultRelativePath = await saveOriginalToVault(actorUserId, fileName, buffer);
        const content = await parseDocumentContent(buffer, fileName);
        const category =
            forcedCategory ??
            resolveCorpusCategory({
                fileName,
                relativePath,
                title: content.title,
                textSnippet: content.text,
            });
        const { corpusRelativePath, mdFileName } = buildOutputPaths(actorUserId, corpusUserId, category, fileName);
        const parsed = {
            fileName,
            ...content,
            vaultRelativePath,
            corpusRelativePath,
        };
        const writtenPath = await writeParsedToCorpus(corpusUserId, category, mdFileName, parsed);
        return docParseFileResultSchema.parse({
            fileName,
            ok: true,
            format: detectDocFormat(fileName),
            category,
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
    const { actorUserId, corpusUserId, indexAfter = true, logger } = options;
    if (files.length === 0) {
        throw new Error("至少上传 1 个文件");
    }
    await ensureCorpusUserLayout(corpusUserId, actorUserId);
    const limit = pLimit(getDocParseConcurrency());
    logger?.info({
        fileCount: files.length,
        actorUserId,
        corpusUserId,
        forcedCategory: options.category,
        concurrency: getDocParseConcurrency(),
    }, "doc parse batch started");
    const results = await Promise.all(files.map((file) => limit(() => ingestOneFile(file, options))));
    const categorySummary = emptyCategorySummary();
    for (const result of results) {
        if (result.ok && result.category)
            bumpCategorySummary(categorySummary, result.category);
    }
    const successCount = results.filter((r) => r.ok).length;
    logger?.info({ successCount, total: results.length, categorySummary }, "doc parse batch files done");
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
        categorySummary: docParseCategorySummarySchema.parse(categorySummary),
        indexed,
        indexResult,
        files: results,
    });
};
