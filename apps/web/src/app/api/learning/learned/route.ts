import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { getAuthSession } from "@fambrain/auth";
import { getCorpusLearnedDir, listMarkdownFiles, toRepoPath } from "@fambrain/corpus/paths";
import { resolveCorpusUserId } from "@/server/knowledge/resolve-corpus-user";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const titleFromMarkdown = (fileName: string, body: string): string => {
    const line = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
    return line || fileName.replace(/\.md$/i, "");
};

export const GET = async () => {
    const session = await getAuthSession();
    if (!session) {
        return NextResponse.json({ error: "未登录" }, { status: 401 });
    }
    if (session.status !== "ACTIVE") {
        return NextResponse.json({ error: "账号未激活" }, { status: 403 });
    }
    const corpusUserId = await resolveCorpusUserId(session.userId);
    const learnedRoot = getCorpusLearnedDir(corpusUserId);
    const files = await listMarkdownFiles(learnedRoot);
    const items = await Promise.all(
        files.map(async (abs) => {
            const body = await readFile(abs, "utf8").catch(() => "");
            const repoPath = toRepoPath(abs);
            const preview = body.replace(/^---[\s\S]*?---\n*/m, "").trim().slice(0, 240);
            const updatedAt = await stat(abs).then((s) => s.mtime.toISOString()).catch(() => null);
            return {
                path: repoPath,
                fileName: path.basename(abs),
                title: titleFromMarkdown(path.basename(abs), body),
                preview,
                updatedAt,
            };
        })
    );
    items.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
    return NextResponse.json({ items });
};
