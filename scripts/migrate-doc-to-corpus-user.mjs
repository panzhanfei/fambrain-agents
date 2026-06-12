#!/usr/bin/env node
/**
 * 将旧版扁平语料 src/doc/{experience,projects,personal}
 * 迁移到 src/doc/users/<corpusUserId>/ 下。
 *
 * 用法：
 *   node scripts/migrate-doc-to-corpus-user.mjs
 *   node scripts/migrate-doc-to-corpus-user.mjs <corpusUserId>
 */
import Database from "better-sqlite3";
import { rename, stat, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const docRoot = path.join(repoRoot, "data/doc");
const folders = ["experience", "projects", "personal"];

const resolveCorpusUserIdFromDb = () => {
  const dbPath = path.join(repoRoot, "packages/db/prisma/dev.db");
  const db = new Database(dbPath, { readonly: true });
  try {
    const row = db
      .prepare(
        `SELECT id, username FROM User
         WHERE role = 'ADMIN' AND status = 'ACTIVE'
         ORDER BY createdAt ASC
         LIMIT 1`
      )
      .get();
    return row ?? null;
  } finally {
    db.close();
  }
};

const exists = async (p) => {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

const arg = process.argv[2]?.trim();
let corpusUserId = arg;
if (!corpusUserId) {
  const admin = resolveCorpusUserIdFromDb();
  if (!admin) {
    console.error("未找到 ACTIVE 的 ADMIN 用户，请传入 userId：");
    console.error("  pnpm run doc:migrate-to-user -- <userId>");
    process.exit(1);
  }
  console.log(`使用主角账号：${admin.username} (${admin.id})`);
  corpusUserId = admin.id;
}

const targetRoot = path.join(docRoot, "users", corpusUserId);
await mkdir(targetRoot, { recursive: true });

for (const folder of folders) {
  const from = path.join(docRoot, folder);
  const to = path.join(targetRoot, folder);
  if (!(await exists(from))) {
    console.log(`跳过（不存在）：${folder}`);
    continue;
  }
  if (await exists(to)) {
    console.log(`跳过（目标已存在）：users/${corpusUserId}/${folder}`);
    continue;
  }
  await rename(from, to);
  console.log(`已移动：${folder} → users/${corpusUserId}/${folder}`);
}

console.log("\n完成。家庭成员检索将使用 User.corpusUserId 或本人目录。");
