import { readdir } from "node:fs/promises";
import path from "node:path";
const SKIP_DIRS = new Set([
    "originals",
    "images",
    "vault",
    "corpus",
    "sources",
]);
export const listMarkdownFiles = async (dir: string): Promise<string[]> => {
    let entries;
    try {
        entries = await readdir(dir, { withFileTypes: true });
    }
    catch {
        return []; // 目录不存在就返回空，不报错
    }
    const files: string[] = [];
    for (const ent of entries) {
        const name = String(ent.name);
        const full = path.join(dir, name);
        if (ent.isDirectory()) {
            if (SKIP_DIRS.has(name))
                continue; // 跳过 vault 等
            files.push(...(await listMarkdownFiles(full))); // 递归
        }
        else if (ent.isFile() && name.endsWith(".md")) {
            files.push(full);
        }
    }
    return files;
};
export const toRepoPath = (absPath: string): string => {
    return path.relative(process.cwd(), absPath).split(path.sep).join("/");
};
