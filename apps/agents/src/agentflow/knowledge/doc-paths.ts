import path from "node:path";

import { findMonorepoRoot } from "./repo-root";

/** 知识库根目录（monorepo 内 `data/doc`） */
export const DOC_ROOT = path.join(findMonorepoRoot(), "data/doc");

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

/** `data/doc/users/<userId>` */
export function getUserHome(userId: string): string {
  return path.join(DOC_ROOT, DOC_USERS_DIR, userId);
}

/** `data/doc/users/<userId>/corpus` */
export function getUserCorpusRoot(corpusUserId: string): string {
  return path.join(getUserHome(corpusUserId), CORPUS_DIR);
}

/** `data/doc/users/<userId>/vault` */
export function getUserVaultRoot(userId: string): string {
  return path.join(getUserHome(userId), VAULT_DIR);
}

/** `data/doc/users/<userId>/vault/originals/uploads` */
export function getVaultUploadsRoot(userId: string): string {
  return path.join(getUserVaultRoot(userId), VAULT_UPLOADS_DIR);
}

/** `data/doc/users/<userId>/corpus/<category>/imports` */
export function getCorpusImportDir(
  corpusUserId: string,
  category: CorpusCategory
): string {
  return path.join(getUserCorpusRoot(corpusUserId), category, CORPUS_IMPORTS_DIR);
}

async function corpusHasMarkdown(
  corpusRoot: string,
  listMarkdownFiles: (dir: string) => Promise<string[]>
): Promise<boolean> {
  for (const folder of SCAN_FOLDERS) {
    const files = await listMarkdownFiles(path.join(corpusRoot, folder));
    if (files.length > 0) return true;
  }
  return false;
}

/**
 * 返回 RAG 待扫描根路径（其下为 experience / projects / personal）。
 * 优先级：users/id/corpus → users/id 直下（过渡）→ data/doc 根下扁平（旧版）。
 */
export async function listCorpusScanRoots(
  corpusUserId: string,
  listMarkdownFiles: (dir: string) => Promise<string[]>
): Promise<CorpusScanRoot[]> {
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
}
