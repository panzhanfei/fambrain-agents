import { readFile } from "node:fs/promises";
import path from "node:path";
import { buildBm25Index } from "./bm25";
import { listCorpusScanRoots, CORPUS_SCAN_FOLDERS } from "./doc-paths";
import { listMarkdownFiles, toRepoPath } from "./list-markdown-files";
import { tokenizeForRecall } from "./recall-tokenize";

/** 扫盘读入 body 上限（与 KM SCAN_BODY_MAX 对齐） */
export const SPARSE_BODY_MAX = 4000;

export const SPARSE_EXCERPT_MAX = 320;

export type RecallKeywordHit = {
    path: string;
    title: string;
    body: string;
    excerpt: string;
    score: number;
    recallChannel: "sparse";
};

type ScoredDoc = {
    path: string;
    title: string;
    body: string;
    tokens: string[];
};

const titleFromMarkdown = (fileName: string, body: string): string => {
    const line = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
    return line || fileName.replace(/\.md$/i, "");
};

const pickExcerpt = (body: string, queryTokens: string[]): string => {
    const text = body.replace(/\s+/g, " ").trim();
    if (!text) return "";
    const lower = text.toLowerCase();
    let idx = -1;
    for (const t of queryTokens) {
        const i = lower.indexOf(t);
        if (i >= 0 && (idx < 0 || i < idx)) idx = i;
    }
    if (idx < 0) return text.slice(0, SPARSE_EXCERPT_MAX);
    const start = Math.max(0, idx - 60);
    const slice = text.slice(start, start + SPARSE_EXCERPT_MAX);
    return (
        (start > 0 ? "…" : "") +
        slice +
        (start + SPARSE_EXCERPT_MAX < text.length ? "…" : "")
    );
};

const loadSparseDocuments = async (
    corpusUserId: string
): Promise<ScoredDoc[]> => {
    const docs: ScoredDoc[] = [];
    const scanRoots = await listCorpusScanRoots(corpusUserId, listMarkdownFiles);
    for (const { root: corpusRoot } of scanRoots) {
        for (const folder of CORPUS_SCAN_FOLDERS) {
            const dir = path.join(corpusRoot, folder);
            for (const abs of await listMarkdownFiles(dir)) {
                const body = await readFile(abs, "utf8").catch(() => "");
                if (!body) continue;
                const repoPath = toRepoPath(abs);
                const title = titleFromMarkdown(path.basename(abs), body);
                const clipped = body.slice(0, SPARSE_BODY_MAX);
                const haystack = `${repoPath} ${title} ${clipped}`;
                docs.push({
                    path: repoPath,
                    title,
                    body: clipped,
                    tokens: tokenizeForRecall(haystack),
                });
            }
        }
    }
    return docs;
};

/**
 * HY-01：BM25 sparse 检索（独立于 Chroma，可单独出 candidates）。
 * 保留 recallKeywordRetrieve 导出名，供 compare-recall / verify 使用。
 */
export const recallKeywordRetrieve = async (
    corpusUserId: string,
    searchQuery: string,
    topK = 12
): Promise<RecallKeywordHit[]> => {
    const queryTokens = tokenizeForRecall(searchQuery);
    if (queryTokens.length === 0) return [];

    const documents = await loadSparseDocuments(corpusUserId);
    if (documents.length === 0) return [];

    const bm25 = buildBm25Index(documents.map((d) => d.tokens));
    const scores = bm25.score(queryTokens);

    const ranked = documents
        .map((doc, i) => ({ doc, score: scores[i] ?? 0 }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);

    return ranked.map(({ doc, score }) => ({
        path: doc.path,
        title: doc.title,
        body: doc.body,
        excerpt: pickExcerpt(doc.body, queryTokens),
        score,
        recallChannel: "sparse" as const,
    }));
};

/** HY-01 别名，语义更清晰。 */
export const recallSparseRetrieve = recallKeywordRetrieve;
