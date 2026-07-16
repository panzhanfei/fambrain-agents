/**
 * 语料列举分页：按 path 排序后 slice，供 exhaustive / continue 路径使用。
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
    listCorpusScanRoots,
    listMarkdownFiles,
    toRepoPath,
} from "@fambrain/corpus";
import { EXCERPT_MAX } from "../profile/km-config";
import {
    isExperienceEntryPath,
    isProjectEntryPath,
    pickExcerpt,
} from "../recall/retrieve-helpers";
import type { KnowledgeHit } from "../contract/types";

export const ENUMERATION_PREVIEW_PAGE_SIZE = 8;
export const ENUMERATION_EXHAUSTIVE_PAGE_SIZE = 20;

export type CorpusListKind = "project" | "experience";

export type CorpusEntryRow = {
    path: string;
    title: string;
    body: string;
};

const titleFromMarkdown = (fileName: string, body: string): string => {
    const line = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
    return line || fileName.replace(/\.md$/i, "");
};

const isTargetPath = (
    repoPath: string,
    listKind: CorpusListKind
): boolean =>
    listKind === "project"
        ? isProjectEntryPath(repoPath)
        : isExperienceEntryPath(repoPath);

const scanEntries = async (
    corpusUserId: string,
    listKind: CorpusListKind
): Promise<CorpusEntryRow[]> => {
    const subdir = listKind === "project" ? "projects" : "experience";
    const scanRoots = await listCorpusScanRoots(corpusUserId, listMarkdownFiles);
    const entries: CorpusEntryRow[] = [];
    for (const { root: corpusRoot } of scanRoots) {
        const dir = path.join(corpusRoot, subdir);
        for (const abs of await listMarkdownFiles(dir)) {
            const repoPath = toRepoPath(abs);
            if (!isTargetPath(repoPath, listKind)) continue;
            const body = await readFile(abs, "utf8").catch(() => "");
            if (!body.trim()) continue;
            entries.push({
                path: repoPath,
                title: titleFromMarkdown(path.basename(abs), body),
                body,
            });
        }
    }
    return entries.sort((a, b) => a.path.localeCompare(b.path));
};

export const listAllCorpusEntries = async (input: {
    corpusUserId: string;
    listKind: CorpusListKind;
}): Promise<CorpusEntryRow[]> => scanEntries(input.corpusUserId, input.listKind);

export const listCorpusEntriesPage = async (input: {
    corpusUserId: string;
    listKind: CorpusListKind;
    page: number;
    pageSize: number;
}): Promise<{
    items: CorpusEntryRow[];
    total: number;
    page: number;
    pageSize: number;
    hasMore: boolean;
}> => {
    const page = Math.max(1, input.page);
    const pageSize = Math.max(1, input.pageSize);
    const all = await scanEntries(input.corpusUserId, input.listKind);
    const total = all.length;
    const offset = (page - 1) * pageSize;
    const slice = all.slice(offset, offset + pageSize);
    return {
        items: slice,
        total,
        page,
        pageSize,
        hasMore: offset + slice.length < total,
    };
};

export const corpusEntryToHit = (entry: CorpusEntryRow): KnowledgeHit => ({
    path: entry.path,
    title: entry.title,
    excerpt:
        pickExcerpt(entry.body, [], "enumeration") ||
        entry.body.slice(0, EXCERPT_MAX).trim(),
    relevance: 0.5,
});
