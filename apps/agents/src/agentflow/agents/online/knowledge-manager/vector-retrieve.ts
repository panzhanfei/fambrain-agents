import { searchCorpusVectors } from "@/agentflow/knowledge/corpus-vector";

/** @deprecated 请使用 `searchCorpusVectors`；保留别名供实验脚本兼容 */
export async function vectorRetrieve(
  corpusUserId: string,
  searchQuery: string,
  topK = 12
) {
  return searchCorpusVectors(corpusUserId, searchQuery, topK);
}
