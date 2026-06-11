/**
 * @deprecated 请使用 `@/agentflow/knowledge/corpus-vector`；此处保留 re-export 以兼容旧 import。
 */
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
