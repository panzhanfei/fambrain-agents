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
  DOC_USERS_DIR,
  CORPUS_DIR,
  VAULT_DIR,
  VAULT_UPLOADS_DIR,
  CORPUS_IMPORTS_DIR,
  SCAN_FOLDERS,
  getUserHome,
  getUserCorpusRoot,
  getUserVaultRoot,
  getVaultUploadsRoot,
  getCorpusImportDir,
  listCorpusScanRoots,
  type CorpusCategory,
  type CorpusScanRoot,
} from "./doc-paths";
export { findMonorepoRoot } from "./repo-root";
export { listVaultFiles, type VaultFileEntry } from "./list-vault-files";
export {
  recallKeywordRetrieve,
  type RecallKeywordHit,
} from "./recall-keyword-retrieve";
