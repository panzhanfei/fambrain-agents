import path from "node:path";
import { findMonorepoRoot } from "./repo-root";
/** 知识库根目录（monorepo 内 `data/doc`；测试可设 `FAMBRAIN_DOC_ROOT_OVERRIDE`） */
export const DOC_ROOT = (() => {
    const override = process.env.FAMBRAIN_DOC_ROOT_OVERRIDE?.trim();
    if (override)
        return path.resolve(override);
    return path.join(findMonorepoRoot(), "data/doc");
})();
export const DOC_USERS_DIR = "users";
/** Agent 检索用的 Markdown 语料（可授权共享） */
export const CORPUS_DIR = "corpus";
/** 私人原件（PDF / Word / 图片等），不参与 RAG 扫描 */
export const VAULT_DIR = "vault";
export const VAULT_UPLOADS_DIR = "originals/uploads";
/** 解析后的 Markdown 默认写入 corpus/<category>/imports/ */
export const CORPUS_IMPORTS_DIR = "imports";
export const SCAN_FOLDERS = ["experience", "projects", "personal"] as const;
export type CorpusCategory = (typeof SCAN_FOLDERS)[number];
export type CorpusScanRoot = {
    /** 其下直接包含 experience / projects / personal */
    root: string;
    layout: "corpus" | "user-flat" | "legacy-flat";
};
export const getUserHome = (userId: string): string => {
    return path.join(DOC_ROOT, DOC_USERS_DIR, userId);
};
export const getUserCorpusRoot = (corpusUserId: string): string => {
    return path.join(getUserHome(corpusUserId), CORPUS_DIR);
};
export const getUserVaultRoot = (userId: string): string => {
    return path.join(getUserHome(userId), VAULT_DIR);
};
export const getVaultUploadsRoot = (userId: string): string => {
    return path.join(getUserVaultRoot(userId), VAULT_UPLOADS_DIR);
};
export const getCorpusImportDir = (corpusUserId: string, category: CorpusCategory): string => {
    return path.join(getUserCorpusRoot(corpusUserId), category, CORPUS_IMPORTS_DIR);
};
const corpusHasMarkdown = async (corpusRoot: string, listMarkdownFiles: (dir: string) => Promise<string[]>): Promise<boolean> => {
    for (const folder of SCAN_FOLDERS) {
        const files = await listMarkdownFiles(path.join(corpusRoot, folder));
        if (files.length > 0)
            return true;
    }
    return false;
};
export const listCorpusScanRoots = async (corpusUserId: string, listMarkdownFiles: (dir: string) => Promise<string[]>): Promise<CorpusScanRoot[]> => {
    const corpusRoot = getUserCorpusRoot(corpusUserId);
    if (await corpusHasMarkdown(corpusRoot, listMarkdownFiles)) {
        return [{ root: corpusRoot, layout: "corpus" }];
    }
    const userFlat = getUserHome(corpusUserId);
    if (await corpusHasMarkdown(userFlat, listMarkdownFiles)) {
        return [{ root: userFlat, layout: "user-flat" }];
    }
    if (await corpusHasMarkdown(DOC_ROOT, listMarkdownFiles)) {
        return [{ root: DOC_ROOT, layout: "legacy-flat" }];
    }
    return [{ root: corpusRoot, layout: "corpus" }];
};
