import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { toRepoPath } from "@/agentflow/agents/offline/knowledge-indexer/list-markdown-files";
import {
  getCorpusImportDir,
  getVaultUploadsRoot,
  type CorpusCategory,
} from "@/agentflow/knowledge";

import type { ParsedDocument } from "./schema";

export async function saveOriginalToVault(
  actorUserId: string,
  fileName: string,
  buffer: Buffer
): Promise<string> {
  const uploadsRoot = getVaultUploadsRoot(actorUserId);
  await mkdir(uploadsRoot, { recursive: true });

  const safeName = fileName.replace(/[^\w.\-()\u4e00-\u9fff]+/g, "_");
  const absPath = path.join(uploadsRoot, safeName);
  await writeFile(absPath, buffer);

  return path
    .join("users", actorUserId, "vault", "originals", "uploads", safeName)
    .split(path.sep)
    .join("/");
}

export function buildCorpusMarkdown(parsed: ParsedDocument): string {
  const now = new Date().toISOString();
  return `# ${parsed.title}

> 来源：\`${parsed.vaultRelativePath}\` · 格式：${parsed.format} · 解析于 ${now}

${parsed.text.trim()}
`;
}

export async function writeParsedToCorpus(
  corpusUserId: string,
  category: CorpusCategory,
  mdFileName: string,
  parsed: ParsedDocument
): Promise<string> {
  const importDir = getCorpusImportDir(corpusUserId, category);
  await mkdir(importDir, { recursive: true });

  const absPath = path.join(importDir, mdFileName);
  await writeFile(absPath, buildCorpusMarkdown(parsed), "utf8");

  return toRepoPath(absPath);
}
