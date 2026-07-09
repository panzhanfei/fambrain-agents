import type { Citation } from "@/agentflow/brain-service/online/information-analyst/prompt";
import type { KnowledgeHit } from "@/agentflow/brain-service/online/knowledge-manager";
const MAX_HITS = 5;
const EXCERPT_MAX = 320;
export const normalizeDocPath = (path: string): string => {
    return path.trim().replace(/\\/g, "/");
};
const mergeExcerptText = (a: string, b: string): string => {
    const x = a.trim();
    const y = b.trim();
    if (!x)
        return y;
    if (!y)
        return x;
    if (x === y)
        return x;
    if (x.includes(y))
        return x;
    if (y.includes(x))
        return y;
    const merged = `${x} / ${y}`;
    if (merged.length <= EXCERPT_MAX)
        return merged;
    return `${merged.slice(0, EXCERPT_MAX - 1)}…`;
};
const pickTitle = (a: string, b: string): string => {
    const left = a.trim();
    const right = b.trim();
    if (!left)
        return right;
    if (!right)
        return left;
    return left.length >= right.length ? left : right;
};
export const organizeHits = (hits: KnowledgeHit[], maxHits = MAX_HITS): KnowledgeHit[] => {
    const byPath = new Map<string, KnowledgeHit>();
    for (const hit of hits) {
        const path = normalizeDocPath(hit.path);
        const excerpt = String(hit.excerpt ?? "").trim();
        if (!path || !excerpt)
            continue;
        const title = String(hit.title ?? "").trim();
        const relevance = Math.min(1, Math.max(0, Number(hit.relevance) || 0));
        const existing = byPath.get(path);
        if (!existing) {
            byPath.set(path, { path, title, excerpt, relevance });
            continue;
        }
        byPath.set(path, {
            path,
            title: pickTitle(existing.title, title),
            excerpt: mergeExcerptText(existing.excerpt, excerpt),
            relevance: Math.max(existing.relevance, relevance),
        });
    }
    return [...byPath.values()]
        .sort((a, b) => b.relevance - a.relevance)
        .slice(0, maxHits);
};
export const dedupeCitations = (citations: Citation[]): Citation[] => {
    const byPath = new Map<string, Citation>();
    for (const c of citations) {
        const path = normalizeDocPath(c.path);
        const excerpt = String(c.excerpt ?? "").trim();
        if (!path || !excerpt)
            continue;
        const existing = byPath.get(path);
        if (!existing) {
            byPath.set(path, { path, excerpt });
            continue;
        }
        byPath.set(path, {
            path,
            excerpt: mergeExcerptText(existing.excerpt, excerpt),
        });
    }
    return [...byPath.values()];
};
