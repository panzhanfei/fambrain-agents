import { corpusCollectionName } from "@/agentflow/agents/offline/knowledge-indexer";
import { openCorpusVectorStore } from "@/agentflow/knowledge";

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
