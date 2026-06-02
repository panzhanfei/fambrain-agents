import { readdir, stat } from "node:fs/promises";
import path from "node:path";

import { getUserVaultRoot } from "./doc-paths";

export type VaultFileEntry = {
  /** 相对 vault 根目录，如 `originals/uploads/report.pdf` */
  relativePath: string;
  name: string;
  sizeBytes: number;
  modifiedAt: string;
};

async function walkVaultDir(
  dir: string,
  vaultRoot: string,
  out: VaultFileEntry[]
): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkVaultDir(abs, vaultRoot, out);
      continue;
    }
    if (!entry.isFile()) continue;

    const st = await stat(abs).catch(() => null);
    if (!st) continue;

    out.push({
      relativePath: path.relative(vaultRoot, abs).replace(/\\/g, "/"),
      name: entry.name,
      sizeBytes: st.size,
      modifiedAt: st.mtime.toISOString(),
    });
  }
}

/** 递归列出 `data/doc/users/<userId>/vault/` 下文件（只读，不参与 RAG） */
export async function listVaultFiles(userId: string): Promise<VaultFileEntry[]> {
  const vaultRoot = getUserVaultRoot(userId);
  const out: VaultFileEntry[] = [];
  await walkVaultDir(vaultRoot, vaultRoot, out);
  out.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return out;
}
