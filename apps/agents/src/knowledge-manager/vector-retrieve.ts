import { openCorpusVectorStore } from "../knowledge/chroma-rag";
import { corpusCollectionName } from "../knowledge-indexer/constants";

export async function vectorRetrieve(
  corpusUserId: string,
  searchQuery: string,
  topK = 12
) {
  const collectionName = corpusCollectionName(corpusUserId);
  const vectorStore = await openCorpusVectorStore(collectionName);

  const results = await vectorStore.similaritySearchWithScore(searchQuery, topK);

  return results.map(([doc, score]) => ({
    path: String(doc.metadata.path ?? ""),
    title: String(doc.metadata.title ?? ""),
    body: doc.pageContent,
    score,
  }));
}
