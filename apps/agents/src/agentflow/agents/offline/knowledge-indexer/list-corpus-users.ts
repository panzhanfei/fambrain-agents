import { readdir } from "node:fs/promises";
import path from "node:path";
import { DOC_ROOT, DOC_USERS_DIR, getUserCorpusRoot, listMarkdownFiles, toRepoPath, } from "@fambrain/corpus";
import { logIndexerStep } from "./indexer-log";
export const listCorpusUserIds = async (): Promise<string[]> => {
    const usersRoot = path.join(DOC_ROOT, DOC_USERS_DIR);
    logIndexerStep("1a 扫描用户目录", { usersRoot });
    let entries;
    try {
        entries = await readdir(usersRoot, { withFileTypes: true });
    }
    catch {
        logIndexerStep("1a 用户目录不存在", { usersRoot });
        return [];
    }
    const ids: string[] = [];
    const skipped: Array<{ userId: string; reason: string }> = [];
    for (const ent of entries) {
        if (!ent.isDirectory())
            continue;
        const userId = String(ent.name);
        if (userId.startsWith(".")) {
            skipped.push({ userId, reason: "hidden directory" });
            continue;
        }
        const corpusRoot = getUserCorpusRoot(userId);
        const files = await listMarkdownFiles(corpusRoot);
        if (files.length > 0) {
            ids.push(userId);
            logIndexerStep("1b 用户有语料", {
                userId,
                corpusRoot,
                mdFileCount: files.length,
                samplePaths: files.slice(0, 5).map((f) => toRepoPath(f)),
            });
        }
        else {
            skipped.push({ userId, reason: "no markdown under corpus/" });
        }
    }
    logIndexerStep("1c 用户扫描汇总", {
        includedUserIds: ids,
        skippedCount: skipped.length,
        skipped: skipped.slice(0, 10),
    });
    return ids;
};
