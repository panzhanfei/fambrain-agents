import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import dotenv from "dotenv";
import { defineConfig } from "prisma/config";

function findMonorepoRoot(startDir = process.cwd()): string {
  let dir = path.resolve(startDir);
  while (true) {
    if (fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(startDir);
    dir = parent;
  }
}

dotenv.config({ path: path.join(findMonorepoRoot(), ".env") });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env["DATABASE_URL"],
  },
});
