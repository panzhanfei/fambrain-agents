import fs from "node:fs";
import path from "node:path";

import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

import { PrismaClient } from "./generated/prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function findMonorepoRoot(startDir = process.cwd()): string {
  let dir = path.resolve(startDir);
  while (true) {
    if (fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(startDir);
    dir = parent;
  }
}

function createPrisma() {
  const defaultPath = path.join(
    findMonorepoRoot(),
    "packages/db/prisma/dev.db"
  );
  const raw = process.env.DATABASE_URL ?? `file:${defaultPath}`;
  if (!raw.startsWith("file:")) {
    throw new Error(`DATABASE_URL must be a sqlite file URL, got "${raw}".`);
  }
  const relativeOrAbsolute = raw.slice("file:".length);
  const absolute = path.isAbsolute(relativeOrAbsolute)
    ? relativeOrAbsolute
    : path.resolve(findMonorepoRoot(), relativeOrAbsolute);
  const url = `file:${absolute}`;
  const adapter = new PrismaBetterSqlite3({ url });

  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrisma();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export { findMonorepoRoot };
