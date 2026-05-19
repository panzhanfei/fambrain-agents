#!/usr/bin/env node
/**
 * 将 doc 整理为 users/<userId>/corpus 与 users/<userId>/vault 布局。
 *
 * 用法：
 *   pnpm run doc:migrate-layout
 *   pnpm run doc:migrate-layout -- <ownerUserId>
 */
import Database from "better-sqlite3";
import { rename, stat, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const docRoot = path.join(repoRoot, "src/doc");
const corpusFolders = ["experience", "projects", "personal"];
const CORPUS = "corpus";
const VAULT = "vault";

function resolveOwnerFromDb() {
  const dbPath = path.join(repoRoot, "prisma/dev.db");
  const db = new Database(dbPath, { readonly: true });
  try {
    return (
      db
        .prepare(
          `SELECT id, username FROM User
           WHERE role = 'ADMIN' AND status = 'ACTIVE'
           ORDER BY createdAt ASC
           LIMIT 1`
        )
        .get() ?? null
    );
  } finally {
    db.close();
  }
}

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function moveDir(from, to, label) {
  if (!(await exists(from))) {
    console.log(`跳过（不存在）：${label}`);
    return;
  }
  if (await exists(to)) {
    console.log(`跳过（目标已存在）：${label}`);
    return;
  }
  await mkdir(path.dirname(to), { recursive: true });
  await rename(from, to);
  console.log(`已移动：${label}`);
}

const arg = process.argv[2]?.trim();
let ownerUserId = arg;
if (!ownerUserId) {
  const admin = resolveOwnerFromDb();
  if (!admin) {
    console.error("未找到 ACTIVE 的 ADMIN，请传入 ownerUserId：");
    console.error("  pnpm run doc:migrate-layout -- <userId>");
    process.exit(1);
  }
  console.log(`语料 / 全局原件归属：${admin.username} (${admin.id})`);
  ownerUserId = admin.id;
}

const userHome = path.join(docRoot, "users", ownerUserId);
const corpusRoot = path.join(userHome, CORPUS);
const vaultRoot = path.join(userHome, VAULT);

await mkdir(corpusRoot, { recursive: true });
await mkdir(vaultRoot, { recursive: true });

// 1) doc 根下扁平 md → users/id/corpus/
for (const folder of corpusFolders) {
  await moveDir(
    path.join(docRoot, folder),
    path.join(corpusRoot, folder),
    `${folder} (doc 根) → users/.../corpus/${folder}`
  );
}

// 2) users/id 直下 md → users/id/corpus/（上一轮迁移）
for (const folder of corpusFolders) {
  await moveDir(
    path.join(userHome, folder),
    path.join(corpusRoot, folder),
    `${folder} (users/id 直下) → corpus/${folder}`
  );
}

// 3) 全局 originals / sources → users/id/vault/
await moveDir(
  path.join(docRoot, "originals"),
  path.join(vaultRoot, "originals"),
  "originals → users/.../vault/originals"
);
await moveDir(
  path.join(docRoot, "sources"),
  path.join(vaultRoot, "sources"),
  "sources → users/.../vault/sources"
);

// 4) 其他已存在的 users/<id>：仅整理 corpus 直下三层
const usersRoot = path.join(docRoot, "users");
if (await exists(usersRoot)) {
  const { readdir } = await import("node:fs/promises");
  for (const ent of await readdir(usersRoot, { withFileTypes: true })) {
    if (!ent.isDirectory() || ent.name === ownerUserId) continue;
    const otherHome = path.join(usersRoot, ent.name);
    const otherCorpus = path.join(otherHome, CORPUS);
    await mkdir(otherCorpus, { recursive: true });
    for (const folder of corpusFolders) {
      await moveDir(
        path.join(otherHome, folder),
        path.join(otherCorpus, folder),
        `users/${ent.name}/${folder} → corpus/${folder}`
      );
    }
  }
}

console.log("\n完成。RAG 扫描 users/<corpusUserId>/corpus/；私人原件在 users/<actorUserId>/vault/。");
