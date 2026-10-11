import fs from "node:fs";
import path from "node:path";
import type { WorkspaceFileRead } from "./interface";

export type { WorkspaceFileRead } from "./interface";

const TEXT_LIMIT = 200_000;

const monorepoRoot = (): string => {
  let dir = process.cwd();
  for (let i = 0; i < 6; i += 1) {
    if (fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
};

const safeId = (value: string): string | null => {
  const id = value.trim();
  if (!id || id.includes("/") || id.includes("\\") || id.includes("..")) {
    return null;
  }
  return id;
};

export const readWorkspaceFile = (
  corpusUserId: string,
  rel: string
): WorkspaceFileRead => {
  const userId = safeId(corpusUserId);
  if (!userId) return { ok: false, error: "没有这个文件" };
  const root = path.resolve(
    monorepoRoot(),
    "data/doc/users",
    userId,
    "vault/originals/workspace"
  );
  const target = path.resolve(root, rel.trim().replace(/^[/\\]+/, ""));
  if (target !== root && !target.startsWith(root + path.sep)) {
    return { ok: false, error: "路径超出原文库" };
  }
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
    return { ok: false, error: "没有这个文件" };
  }
  const text = fs.readFileSync(target, "utf8");
  return { ok: true, text: text.slice(0, TEXT_LIMIT) };
};
