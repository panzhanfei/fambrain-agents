import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import dotenv from "dotenv";
import { defineConfig } from "prisma/config";
const findMonorepoRoot = (startDir = process.cwd()): string => {
    let dir = path.resolve(startDir);
    while (true) {
        if (fs.existsSync(path.join(dir, "pnpm-workspace.yaml")))
            return dir;
        const parent = path.dirname(dir);
        if (parent === dir)
            return path.resolve(startDir);
        dir = parent;
    }
};
dotenv.config({ path: path.join(findMonorepoRoot(), ".env") });
const resolveDatabaseUrl = (): string => {
    const raw = process.env["DATABASE_URL"];
    if (!raw)
        return `file:${path.join(findMonorepoRoot(), "packages/db/prisma/dev.db")}`;
    if (!raw.startsWith("file:"))
        return raw;
    const relativeOrAbsolute = raw.slice("file:".length);
    const absolute = path.isAbsolute(relativeOrAbsolute)
        ? relativeOrAbsolute
        : path.resolve(findMonorepoRoot(), relativeOrAbsolute);
    return `file:${absolute}`;
};
export default defineConfig({
    schema: "prisma/schema.prisma",
    migrations: {
        path: "prisma/migrations",
    },
    datasource: {
        url: resolveDatabaseUrl(),
    },
});
