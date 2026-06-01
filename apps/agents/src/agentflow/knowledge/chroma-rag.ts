import { Chroma } from "@langchain/community/vectorstores/chroma";
import { OllamaEmbeddings } from "@langchain/ollama";
import { ChromaClient } from "chromadb";

import { getAgentsConfig } from "@fambrain/agent-config";

import { getChromaServerUrl } from "@/agentflow/agents/offline/knowledge-indexer";

export function createOllamaEmbeddings(): OllamaEmbeddings {
  const { ollama } = getAgentsConfig();
  return new OllamaEmbeddings({
    model: ollama.models.embed,
    baseUrl: ollama.baseUrl,
  });
}

export function chromaLibArgs(collectionName: string) {
  return {
    url: getChromaServerUrl(),
    collectionName,
  };
}

export async function deleteChromaCollection(collectionName: string): Promise<void> {
  const client = new ChromaClient({ path: getChromaServerUrl() });
  try {
    await client.deleteCollection({ name: collectionName });
  } catch {
    // 首次入库，collection 不存在
  }
}

export async function openCorpusVectorStore(collectionName: string): Promise<Chroma> {
  return Chroma.fromExistingCollection(
    createOllamaEmbeddings(),
    chromaLibArgs(collectionName)
  );
}
