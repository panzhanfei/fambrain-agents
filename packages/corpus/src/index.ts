export {
  chromaLibArgs,
  corpusCollectionName,
  createOllamaEmbeddings,
  deleteChromaCollection,
  getChromaServerUrl,
  indexCorpusDocuments,
  openCorpusVectorStore,
  searchCorpusVectors,
  type CorpusVectorHit,
  type CorpusVectorIndexResult,
} from "./corpus-vector";
export {
  addDocumentsWithEmbedLimit,
  getEmbedIndexOptions,
  type EmbedIndexOptions,
} from "./embed-batches";
export { chunkMetadataSchema, type ChunkMetadata } from "./chunk-metadata";
export {
  DOC_ROOT,
  getDocRoot,
  DOC_USERS_DIR,
  CORPUS_DIR,
  VAULT_DIR,
  VAULT_UPLOADS_DIR,
  CORPUS_IMPORTS_DIR,
  SCAN_FOLDERS,
  LEARNED_DIR,
  CORPUS_SCAN_FOLDERS,
  getUserHome,
  getUserCorpusRoot,
  getUserVaultRoot,
  getVaultUploadsRoot,
  getCorpusImportDir,
  getCorpusLearnedDir,
  getCorpusLearnedPendingDir,
  listCorpusScanRoots,
  type CorpusCategory,
  type CorpusScanRoot,
} from "./doc-paths";
export { findMonorepoRoot } from "./repo-root";
export { listMarkdownFiles, toRepoPath } from "./list-markdown-files";
export { listVaultFiles, type VaultFileEntry } from "./list-vault-files";
export {
  recallKeywordRetrieve,
  recallSparseRetrieve,
  SPARSE_BODY_MAX,
  SPARSE_EXCERPT_MAX,
  type RecallKeywordHit,
} from "./recall-keyword-retrieve";
export { tokenizeForRecall } from "./recall-tokenize";
export { buildBm25Index, type Bm25Index } from "./bm25";
export {
    buildLearnedMarkdown,
    writeLearnedFactToCorpus,
    type WriteLearnedFactInput,
    type LearnedFactFrontmatter,
} from "./write-learned-md";
