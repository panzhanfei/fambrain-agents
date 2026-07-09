import { getInfraConfig } from "../config";
import { getRedisClient } from "../redis/client";
import type { CompositeSessionKey } from "./composite-answer-cache";

/** 列举分页会话：同 conversation + corpus 下记住 listKind / 页码 */
export type EnumerationListSession = {
    listKind: "project" | "experience";
    lastPage: number;
    pageSize: number;
    total: number;
    updatedAt: number;
};

type MemoryEntry = {
    session: EnumerationListSession;
    expiresAt: number;
};

const memorySessions = new Map<string, MemoryEntry>();

const buildRedisKey = (
    parts: CompositeSessionKey,
    listKind: EnumerationListSession["listKind"]
): string => {
    const cfg = getInfraConfig();
    const conv = parts.conversationId.replace(/[^a-zA-Z0-9_-]/g, "_");
    const corpus = parts.corpusUserId.replace(/[^a-zA-Z0-9_-]/g, "_");
    return `${cfg.compositeAnswerCache.keyPrefix}:enum:${conv}:${corpus}:${listKind}`;
};

export const getEnumerationListSession = async (
    parts: CompositeSessionKey,
    listKind: EnumerationListSession["listKind"]
): Promise<EnumerationListSession | null> => {
    const cfg = getInfraConfig();
    if (!cfg.compositeAnswerCache.enabled) return null;

    const key = buildRedisKey(parts, listKind);
    const redis = getRedisClient();
    if (redis) {
        try {
            if (redis.status !== "ready") await redis.connect();
            const raw = await redis.get(key);
            if (!raw) return null;
            return JSON.parse(raw) as EnumerationListSession;
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
    return entry.session;
};

export const upsertEnumerationListSession = async (
    parts: CompositeSessionKey,
    listKind: EnumerationListSession["listKind"],
    input: Pick<EnumerationListSession, "lastPage" | "pageSize" | "total">
): Promise<void> => {
    const cfg = getInfraConfig();
    if (!cfg.compositeAnswerCache.enabled) return;

    const key = buildRedisKey(parts, listKind);
    const session: EnumerationListSession = {
        listKind,
        lastPage: input.lastPage,
        pageSize: input.pageSize,
        total: input.total,
        updatedAt: Date.now(),
    };

    const redis = getRedisClient();
    if (redis) {
        try {
            if (redis.status !== "ready") await redis.connect();
            const ttlSec = Math.max(
                1,
                Math.ceil(cfg.compositeAnswerCache.ttlMs / 1000)
            );
            await redis.set(key, JSON.stringify(session), "EX", ttlSec);
        } catch {
            /* 写入失败不阻断主链 */
        }
        return;
    }

    memorySessions.set(key, {
        session,
        expiresAt: Date.now() + cfg.compositeAnswerCache.ttlMs,
    });
};

export const clearMemoryEnumerationListSessions = (): void => {
    memorySessions.clear();
};
