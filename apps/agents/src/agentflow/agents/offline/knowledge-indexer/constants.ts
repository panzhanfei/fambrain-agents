import { resolveChromaServerUrl } from "@fambrain/agent-config/service-url";

/** 每个 corpusUserId 对应一个 Chroma collection */
export function corpusCollectionName(corpusUserId: string): string {
  return `fambrain_corpus_${corpusUserId}`;
}

/** 读取 `.env`：优先 `CHROMA_SERVER_URL`，否则 `CHROMA_HOST` + `CHROMA_PORT` */
export function getChromaServerUrl(): string {
  return resolveChromaServerUrl();
}
