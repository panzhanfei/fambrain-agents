type RlBucket = {
    count: number;
    resetAt: number;
};
const bucketStore = (): Map<string, RlBucket> => {
    const g = globalThis as typeof globalThis & {
        __fambrainRateLimit?: Map<string, RlBucket>;
    };
    if (!g.__fambrainRateLimit) {
        g.__fambrainRateLimit = new Map();
    }
    return g.__fambrainRateLimit;
};
let lastPruned = 0;
const pruneStale = (nowMs: number) => {
    if (nowMs - lastPruned < 60000)
        return;
    lastPruned = nowMs;
    const m = bucketStore();
    for (const [k, v] of m) {
        if (v.resetAt <= nowMs)
            m.delete(k);
    }
};
export const tryConsumeSimpleRateLimit = (key: string, limit: number, windowMs: number): {
    ok: true;
} | {
    ok: false;
    retryAfterSec: number;
} => {
    const now = Date.now();
    pruneStale(now);
    let b = bucketStore().get(key);
    if (!b || now > b.resetAt) {
        b = { count: 1, resetAt: now + windowMs };
        bucketStore().set(key, b);
        return { ok: true };
    }
    if (b.count >= limit) {
        const retryAfterSec = Math.max(1, Math.ceil((b.resetAt - now) / 1000));
        return { ok: false, retryAfterSec };
    }
    b.count += 1;
    return { ok: true };
};
export const readRateLimitInts = (rawMax: string | undefined, rawWindowMs: string | undefined, defaults: {
    max: number;
    windowMs: number;
}): {
    max: number;
    windowMs: number;
} => {
    const max = Number.parseInt(rawMax ?? `${defaults.max}`, 10);
    const windowMs = Number.parseInt(rawWindowMs ?? `${defaults.windowMs}`, 10);
    return {
        max: Number.isFinite(max) && max > 0 ? max : defaults.max,
        windowMs: Number.isFinite(windowMs) && windowMs >= 5000 ? windowMs : defaults.windowMs,
    };
};
