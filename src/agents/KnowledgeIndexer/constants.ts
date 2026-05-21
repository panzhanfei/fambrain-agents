import path from "node:path";

/**
 * Chroma 服务端持久化目录（给 `chroma run --path` 用，不是 JS client 的 path）。
 * 例：`chroma run --path ./data/chroma --port 8000`
 */
export const CHROMA_DATA_PATH = path.join(process.cwd(), "data/chroma");

/** 默认 Chroma HTTP 地址（JS client 的 path 必须是 URL） */
export const DEFAULT_CHROMA_SERVER_URL = "http://127.0.0.1:8000";

/** 读取 .env 的 CHROMA_SERVER_URL，未设置则用默认 */
export function getChromaServerUrl(): string {
  const raw = process.env.CHROMA_SERVER_URL?.trim();
  const url = raw && raw.length > 0 ? raw : DEFAULT_CHROMA_SERVER_URL;
  return url.replace(/\/+$/, "");
}

/** 每个 corpusUserId 对应一个 collection */
export function corpusCollectionName(corpusUserId: string): string {
  return `fambrain_corpus_${corpusUserId}`;
}
