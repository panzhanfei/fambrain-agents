import fs from "node:fs";
import path from "node:path";
export const findMonorepoRoot = (startDir = process.cwd()): string => {
    let dir = path.resolve(startDir);
    while (true) {
        if (fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) {
            return dir;
        }
        const parent = path.dirname(dir);
        if (parent === dir)
            return path.resolve(startDir);
        dir = parent;
    }
};
