#!/usr/bin/env node
/**
 * 文档解析入库 CLI：读取本地文件或目录，自动分类后写入 corpus 并可选 index。
 *
 * 用法：
 *   pnpm run parse:documents -- <path1> [path2...]
 *   pnpm run parse:documents -- ./docs --json
 *
 * 语料归属（无需手动传 userId）：
 *   - .env 中 FAMBRAIN_CORPUS_USER_ID / FAMBRAIN_ACTOR_USER_ID
 *   - 否则 data/doc/users/ 下唯一或首个目录
 */
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
    docParserLogger,
    formatDocParseBatchSummary,
    ingestDocumentBatch,
    isSupportedDocFile,
    resolveDefaultIngestIdentity,
} from "@fambrain/agents";
type CliOptions = {
    category?: "experience" | "projects" | "personal";
    indexAfter: boolean;
    json: boolean;
    paths: string[];
};
type CollectedFile = {
    absPath: string;
    relativePath: string;
};
const parseArgs = (argv: string[]): CliOptions => {
    const args = [...argv];
    let category: CliOptions["category"];
    let indexAfter = true;
    let json = false;
    const positional: string[] = [];
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === "--category" && args[i + 1]) {
            category = args[++i] as NonNullable<CliOptions["category"]>;
            continue;
        }
        if (arg === "--no-index") {
            indexAfter = false;
            continue;
        }
        if (arg === "--json") {
            json = true;
            continue;
        }
        positional.push(arg);
    }
    if (positional.length === 0) {
        console.error("用法: pnpm run parse:documents -- <fileOrDir...> [--category personal|projects|experience] [--no-index] [--json]");
        process.exit(1);
    }
    return {
        category,
        indexAfter,
        json,
        paths: positional,
    };
};
const collectFiles = async (inputPath: string, rootLabel: string): Promise<CollectedFile[]> => {
    const st = await stat(inputPath);
    if (st.isFile()) {
        if (!isSupportedDocFile(path.basename(inputPath)))
            return [];
        return [{
            absPath: inputPath,
            relativePath: path.join(rootLabel, path.basename(inputPath)).replace(/\\/g, "/"),
        }];
    }
    const out: CollectedFile[] = [];
    const entries = await readdir(inputPath, { withFileTypes: true });
    for (const ent of entries) {
        const full = path.join(inputPath, ent.name);
        if (ent.isDirectory()) {
            out.push(...(await collectFiles(full, path.join(rootLabel, ent.name))));
        }
        else if (ent.isFile() && isSupportedDocFile(ent.name)) {
            out.push({
                absPath: full,
                relativePath: path.join(rootLabel, ent.name).replace(/\\/g, "/"),
            });
        }
    }
    return out;
};
const main = async () => {
    const opts = parseArgs(process.argv.slice(2));
    const identity = await resolveDefaultIngestIdentity();
    const collected: CollectedFile[] = [];
    for (const p of opts.paths) {
        const resolved = path.resolve(p);
        const rootLabel = path.basename(resolved) || resolved;
        collected.push(...(await collectFiles(resolved, rootLabel)));
    }
    if (collected.length === 0) {
        console.error("未找到可解析文件（支持 pdf/doc/docx/ppt/pptx/常见图片）");
        process.exit(1);
    }
    const files = await Promise.all(collected.map(async ({ absPath, relativePath }) => ({
        fileName: path.basename(absPath),
        buffer: await readFile(absPath),
        relativePath,
    })));
    const result = await ingestDocumentBatch(files, {
        actorUserId: identity.actorUserId,
        corpusUserId: identity.corpusUserId,
        category: opts.category,
        indexAfter: opts.indexAfter,
        logger: docParserLogger,
    });
    if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
    }
    else {
        console.log(formatDocParseBatchSummary(result));
        const failed = result.files.filter((f) => !f.ok);
        for (const f of failed) {
            console.error(`  ✗ ${f.fileName}: ${f.error ?? "未知错误"}`);
        }
    }
};
main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
});
