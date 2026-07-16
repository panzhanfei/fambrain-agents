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
import {
    entryOverlapsTimeWindow,
    extractRoleFromExperienceBody,
} from "./entry-time-window";

export const ENUMERATION_PREVIEW_PAGE_SIZE = 8;
export const ENUMERATION_EXHAUSTIVE_PAGE_SIZE = 20;

export type CorpusListKind = "project" | "experience";

export type CorpusEntryRow = {
    path: string;
    title: string;
    body: string;
    /** experience：职位/角色 */
    role?: string | null;
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
            const role =
                listKind === "experience"
                    ? extractRoleFromExperienceBody(body)
                    : null;
            entries.push({
                path: repoPath,
                title: titleFromMarkdown(path.basename(abs), body),
                body,
                role,
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
    /** 近 N 年；null/省略 = 不过滤 */
    timeWindowYears?: number | null;
    asOfDate?: string | null;
}): Promise<{
    items: CorpusEntryRow[];
    total: number;
    page: number;
    pageSize: number;
    hasMore: boolean;
}> => {
    const page = Math.max(1, input.page);
    const pageSize = Math.max(1, input.pageSize);
    let all = await scanEntries(input.corpusUserId, input.listKind);
    const tw = input.timeWindowYears;
    if (tw != null && tw > 0) {
        all = all.filter((e) =>
            entryOverlapsTimeWindow({
                path: e.path,
                body: e.body,
                timeWindowYears: tw,
                asOfDate: input.asOfDate,
            })
        );
    }
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

export const corpusEntryToHit = (entry: CorpusEntryRow): KnowledgeHit => {
    const excerptBase =
        pickExcerpt(entry.body, [], "enumeration") ||
        entry.body.slice(0, EXCERPT_MAX).trim();
    const role = entry.role?.trim();
    const excerpt =
        role && !excerptBase.includes(role)
            ? `角色：${role}\n${excerptBase}`
            : excerptBase;
    return {
        path: entry.path,
        title: entry.title,
        excerpt,
        relevance: 0.5,
    };
};
