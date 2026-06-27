/** 路径与文件列举（无 Chroma / 向量依赖，供 Web 等轻量场景使用） */
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
