import path from "node:path";
import { fileURLToPath } from "node:url";
import { findMonorepoRoot } from "@fambrain/corpus";

let cachedRoot: string | null = null;

/** 仓库根目录（含 pnpm-workspace.yaml 与根 .env） */
export const getMonorepoRoot = (): string => {
    if (cachedRoot)
        return cachedRoot;
    const configDir = path.dirname(fileURLToPath(import.meta.url));
    cachedRoot = findMonorepoRoot(configDir);
    return cachedRoot;
};
