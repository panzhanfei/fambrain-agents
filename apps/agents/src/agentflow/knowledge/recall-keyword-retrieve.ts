import { readFile } from "node:fs/promises";
import path from "node:path";
import { listMarkdownFiles, toRepoPath } from "@/agentflow/agents/offline/knowledge-indexer";
import { listCorpusScanRoots, SCAN_FOLDERS } from "./doc-paths";
const CJK_RUN = /^[\u4e00-\u9fff]+$/;
const tokenize = (...parts: string[]): string[] => {
    const raw = parts.join(" ").toLowerCase();
    const segments = raw
        .split(/[^a-z0-9\u4e00-\u9fff]+/i)
        .filter((t) => t.length >= 2);
    const expanded: string[] = [];
    for (const t of segments) {
        expanded.push(t);
        if (CJK_RUN.test(t) && t.length > 2) {
            for (let i = 0; i < t.length - 1; i++) {
                expanded.push(t.slice(i, i + 2));
            }
        }
    }
    return [...new Set(expanded)];
};
export type RecallKeywordHit = {
    path: string;
    title: string;
    excerpt: string;
    score: number;
};
export const recallKeywordRetrieve = async (corpusUserId: string, searchQuery: string, topK = 12): Promise<RecallKeywordHit[]> => {
    const tokens = tokenize(searchQuery);
    if (tokens.length === 0)
        return [];
    type Scored = RecallKeywordHit & {
        body: string;
    };
    const scored: Scored[] = [];
    const scanRoots = await listCorpusScanRoots(corpusUserId, listMarkdownFiles);
    for (const { root: corpusRoot } of scanRoots) {
        for (const folder of SCAN_FOLDERS) {
            const dir = path.join(corpusRoot, folder);
            for (const abs of await listMarkdownFiles(dir)) {
                const body = await readFile(abs, "utf8").catch(() => "");
                if (!body)
                    continue;
                const repoPath = toRepoPath(abs);
                const haystack = `${repoPath} ${body}`.toLowerCase();
                let score = 0;
                for (const t of tokens) {
                    if (haystack.includes(t))
                        score += 1;
                }
                if (score === 0)
                    continue;
                const title = body.match(/^#\s+(.+)$/m)?.[1]?.trim() ??
                    path.basename(abs).replace(/\.md$/i, "");
                const lower = body.replace(/\s+/g, " ").trim().toLowerCase();
                let idx = -1;
                for (const t of tokens) {
                    const i = lower.indexOf(t);
                    if (i >= 0 && (idx < 0 || i < idx))
                        idx = i;
                }
                const excerpt = idx < 0
                    ? body.slice(0, 320)
                    : body
                        .replace(/\s+/g, " ")
                        .slice(Math.max(0, idx - 60), Math.max(0, idx - 60) + 320);
                scored.push({ path: repoPath, title, excerpt, score, body });
            }
        }
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK).map(({ path, title, excerpt, score }) => ({
        path,
        title,
        excerpt,
        score,
    }));
};
