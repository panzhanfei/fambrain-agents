#!/usr/bin/env node
/**
 * 文档解析入库 CLI：读取本地文件或目录，解析后写入 corpus 并可选 index。
 *
 * 用法：
 *   pnpm run parse:documents -- <userId> <path1> [path2...]
 *   pnpm run parse:documents -- <userId> ./docs --category projects --no-index
 */
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import {
  docParserLogger,
  ingestDocumentBatch,
  isSupportedDocFile,
} from "@fambrain/agents";

type CliOptions = {
  actorUserId: string;
  corpusUserId: string;
  category: "experience" | "projects" | "personal";
  indexAfter: boolean;
  paths: string[];
};

function parseArgs(argv: string[]): CliOptions {
  const args = [...argv];
  let category: CliOptions["category"] = "personal";
  let indexAfter = true;
  let corpusUserId: string | undefined;

  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--category" && args[i + 1]) {
      category = args[++i] as CliOptions["category"];
      continue;
    }
    if (arg === "--corpus-user" && args[i + 1]) {
      corpusUserId = args[++i];
      continue;
    }
    if (arg === "--no-index") {
      indexAfter = false;
      continue;
    }
    positional.push(arg);
  }

  const actorUserId = positional[0];
  const paths = positional.slice(1);
  if (!actorUserId || paths.length === 0) {
    console.error(
      "用法: pnpm run parse:documents -- <actorUserId> <fileOrDir...> [--category personal|projects|experience] [--corpus-user <id>] [--no-index]"
    );
    process.exit(1);
  }

  return {
    actorUserId,
    corpusUserId: corpusUserId ?? actorUserId,
    category,
    indexAfter,
    paths,
  };
}

async function collectFiles(inputPath: string): Promise<string[]> {
  const st = await stat(inputPath);
  if (st.isFile()) return [inputPath];

  const out: string[] = [];
  const entries = await readdir(inputPath, { withFileTypes: true });
  for (const ent of entries) {
    const full = path.join(inputPath, ent.name);
    if (ent.isDirectory()) {
      out.push(...(await collectFiles(full)));
    } else if (ent.isFile() && isSupportedDocFile(ent.name)) {
      out.push(full);
    }
  }
  return out;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const filePaths: string[] = [];
  for (const p of opts.paths) {
    filePaths.push(...(await collectFiles(path.resolve(p))));
  }

  if (filePaths.length === 0) {
    console.error("未找到可解析文件（支持 pdf/doc/docx/ppt/pptx/常见图片）");
    process.exit(1);
  }

  const files = await Promise.all(
    filePaths.map(async (absPath) => ({
      fileName: path.basename(absPath),
      buffer: await readFile(absPath),
    }))
  );

  const result = await ingestDocumentBatch(files, {
    actorUserId: opts.actorUserId,
    corpusUserId: opts.corpusUserId,
    category: opts.category,
    indexAfter: opts.indexAfter,
    logger: docParserLogger,
  });

  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
