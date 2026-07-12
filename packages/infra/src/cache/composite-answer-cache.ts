import type { AssistantMessageBlock } from "@fambrain/brain-types";
import { getInfraConfig } from "../config";
import { getRedisClient } from "../redis/client";
import { normalizeSearchQuery } from "./keys";

/** 槽答案缓存：单 facet 子问终稿（会话级 composite 增量 cache） */
export type CachedFacetAnswer = {
  facetKey: string;
  label: string;
  answer: string;
  citations: Array<{ path: string; excerpt: string }>;
  coverage: "sufficient" | "partial" | "none";
  insufficientEvidence: boolean;
  confidence: number;
  cachedAt: number;
  /** 列举型 UI 块；槽答案缓存命中时优先于 prose 重渲染 */
  blocks?: AssistantMessageBlock[];
  enumerationPage?: number;
  enumerationTotal?: number;
  listKind?: "project" | "experience";
};

export type CompositeSessionSnapshot = {
  facets: Record<string, CachedFacetAnswer>;
  lastUserQuestion?: string;
  lastFullAnswer?: string;
  lastFacetKeys?: string[];
  updatedAt: number;
};

export type CompositeSessionKey = {
  conversationId: string;
  corpusUserId: string;
};

type MemorySessionEntry = {
  snapshot: CompositeSessionSnapshot;
  expiresAt: number;
};

const memorySessions = new Map<string, MemorySessionEntry>();

const buildSessionRedisKey = (parts: CompositeSessionKey): string => {
  const cfg = getInfraConfig();
  const conv = parts.conversationId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const corpus = parts.corpusUserId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `${cfg.compositeAnswerCache.keyPrefix}:${conv}:${corpus}`;
};

const pruneMemoryIfNeeded = (maxEntries: number): void => {
  if (memorySessions.size <= maxEntries) return;
  const overflow = memorySessions.size - maxEntries;
  const keys = memorySessions.keys();
  for (let i = 0; i < overflow; i++) {
    const k = keys.next().value;
    if (k) memorySessions.delete(k);
  }
};

export const isFacetAnswerReusable = (
  cached: CachedFacetAnswer | null | undefined
): cached is CachedFacetAnswer => {
  if (!cached) return false;
  if (cached.insufficientEvidence) return false;
  if (cached.coverage === "none") return false;
  return cached.answer.trim().length > 0;
};

export const getCompositeSession = async (
  parts: CompositeSessionKey
): Promise<CompositeSessionSnapshot | null> => {
  const cfg = getInfraConfig();
  if (!cfg.compositeAnswerCache.enabled) return null;

  const key = buildSessionRedisKey(parts);
  const redis = getRedisClient();
  if (redis) {
    try {
      if (redis.status !== "ready") await redis.connect();
      const raw = await redis.get(key);
      if (!raw) return null;
      return JSON.parse(raw) as CompositeSessionSnapshot;
    } catch {
      return null;
    }
  }

  const entry = memorySessions.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    memorySessions.delete(key);
    return null;
  }
  return entry.snapshot;
};

export const setCompositeSession = async (
  parts: CompositeSessionKey,
  snapshot: CompositeSessionSnapshot
): Promise<void> => {
  const cfg = getInfraConfig();
  if (!cfg.compositeAnswerCache.enabled) return;

  const key = buildSessionRedisKey(parts);
  const redis = getRedisClient();
  if (redis) {
    try {
      if (redis.status !== "ready") await redis.connect();
      const ttlSec = Math.max(
        1,
        Math.ceil(cfg.compositeAnswerCache.ttlMs / 1000)
      );
      await redis.set(key, JSON.stringify(snapshot), "EX", ttlSec);
    } catch {
      /* 写入失败不阻断主链 */
    }
    return;
  }

  pruneMemoryIfNeeded(cfg.compositeAnswerCache.maxEntries);
  memorySessions.set(key, {
    snapshot,
    expiresAt: Date.now() + cfg.compositeAnswerCache.ttlMs,
  });
};

export const clearCompositeSession = async (
  parts: CompositeSessionKey
): Promise<void> => {
  const key = buildSessionRedisKey(parts);
  const redis = getRedisClient();
  if (redis) {
    try {
      if (redis.status !== "ready") await redis.connect();
      await redis.del(key);
    } catch {
      //
    }
  }
  memorySessions.delete(key);
};

export const upsertFacetAnswers = async (
  parts: CompositeSessionKey,
  input: {
    facets: CachedFacetAnswer[];
    userQuestion: string;
    fullAnswer: string;
    facetKeys: string[];
  }
): Promise<void> => {
  const prev = (await getCompositeSession(parts)) ?? {
    facets: {},
    updatedAt: 0,
  };
  const facets = { ...prev.facets };
  for (const f of input.facets) {
    facets[f.facetKey] = f;
  }
  await setCompositeSession(parts, {
    facets,
    lastUserQuestion: normalizeSearchQuery(input.userQuestion),
    lastFullAnswer: input.fullAnswer,
    lastFacetKeys: input.facetKeys,
    updatedAt: Date.now(),
  });
};

export const clearMemoryCompositeAnswerCache = (): void => {
  memorySessions.clear();
};

export type CompositeAnswerCacheBackend = "redis" | "memory" | "disabled";

export const getCompositeAnswerCacheBackend =
  (): CompositeAnswerCacheBackend => {
    const cfg = getInfraConfig();
    if (!cfg.compositeAnswerCache.enabled) return "disabled";
    const redis = getRedisClient();
    if (redis) return "redis";
    return "memory";
  };
