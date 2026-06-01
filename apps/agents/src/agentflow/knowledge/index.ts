export {
  createOllamaEmbeddings,
  chromaLibArgs,
  deleteChromaCollection,
  openCorpusVectorStore,
} from "./chroma-rag";
export { chunkMetadataSchema, type ChunkMetadata } from "./chunk-metadata";
export {
  DOC_ROOT,
  DOC_USERS_DIR,
  CORPUS_DIR,
  SCAN_FOLDERS,
  getUserHome,
  getUserCorpusRoot,
  listCorpusScanRoots,
  type CorpusScanRoot,
} from "./doc-paths";
export { findMonorepoRoot } from "./repo-root";
