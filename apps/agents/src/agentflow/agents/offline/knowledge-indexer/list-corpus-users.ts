import { readdir } from "node:fs/promises";
import path from "node:path";
import { DOC_ROOT, DOC_USERS_DIR, getUserCorpusRoot, listMarkdownFiles, } from "@fambrain/corpus";
export const listCorpusUserIds = async (): Promise<string[]> => {
    const usersRoot = path.join(DOC_ROOT, DOC_USERS_DIR);
    let entries;
    try {
        entries = await readdir(usersRoot, { withFileTypes: true });
    }
    catch {
        return [];
    }
    const ids: string[] = [];
    for (const ent of entries) {
        if (!ent.isDirectory())
            continue;
        const userId = String(ent.name);
        if (userId.startsWith("."))
            continue; // 跳过隐藏目录
        const corpusRoot = getUserCorpusRoot(userId);
        const files = await listMarkdownFiles(corpusRoot);
        if (files.length > 0) {
            ids.push(userId);
        }
    }
    return ids;
};
