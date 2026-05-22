import path from "node:path";

import { resolveChromaServerUrl } from "@fambrain/agent-config/service-url";

import { findMonorepoRoot } from "../knowledge/repo-root";

/** Chroma 服务端持久化目录（给 `pnpm run chroma:server` 用） */
export const CHROMA_DATA_PATH = path.join(findMonorepoRoot(), "data/chroma");

/** 读取 `.env`：优先 `CHROMA_SERVER_URL`，否则 `CHROMA_HOST` + `CHROMA_PORT` */
export function getChromaServerUrl(): string {
  return resolveChromaServerUrl();
}

/** 文档默认值（与 `.env` 中 `CHROMA_PORT=8030` 一致） */
export const DEFAULT_CHROMA_SERVER_URL = "http://127.0.0.1:8030";

/** 每个 corpusUserId 对应一个 collection */
export function corpusCollectionName(corpusUserId: string): string {
  return `fambrain_corpus_${corpusUserId}`;
}
