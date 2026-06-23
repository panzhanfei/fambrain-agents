/**
 * 文档解析师（DocParser）
 * 批量上传 PDF / Word / PPT / 图片 → 解析为 Markdown → 可选 Chroma 入库。
 */
export { docParserLogger } from "./logger";
export { detectDocFormat, isSupportedDocFile, slugifyBaseName, } from "./supported-formats";
export { parseDocumentBuffer, buildOutputPaths, } from "./parse-file";
export { saveOriginalToVault, writeParsedToCorpus, buildCorpusMarkdown, } from "./write-corpus-md";
export { ingestDocumentBatch, getDocParseConcurrency, type UploadFileInput, type IngestBatchOptions, } from "./ingest-batch";
export { resolveCorpusCategory, type ResolveCorpusCategoryInput, } from "./resolve-corpus-category";
export { resolveDefaultIngestIdentity, type IngestIdentity, } from "./resolve-ingest-identity";
export { ensureCorpusUserLayout } from "./ensure-corpus-layout";
export { formatDocParseBatchSummary } from "./format-import-summary";
export { docParseBatchResultSchema, docParseFileResultSchema, docParseCategorySchema, docParseCategorySummarySchema, docUploadFieldSchema, type DocParseBatchResult, type DocParseFileResult, type DocUploadFields, type ParsedDocument, } from "./schema";
