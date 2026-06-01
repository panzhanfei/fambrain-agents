import { Document } from "@langchain/core/documents";

import { chunkMetadataSchema } from "@/agentflow/knowledge";

function titleFromMarkdown(fileName: string, body: string): string {
  const line = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return line || fileName.replace(/\.md$/i, "");
}

export function splitMarkdownToDocuments(
  corpusUserId: string,
  repoPath: string,
  body: string,
  fileName: string
): Document[] {
  const trimmed = body.trim();
  if (!trimmed) return [];

  const title = titleFromMarkdown(fileName, trimmed);
  const sections = trimmed.split(/^## /m);

  // 没有 ## ：整篇一块
  if (sections.length <= 1) {
    const metadata = chunkMetadataSchema.parse({
      corpusUserId,
      path: repoPath,
      title,
      chunkIndex: 0,
    });
    return [
      new Document({
        id: `${corpusUserId}:${repoPath}:0`,
        pageContent: trimmed,
        metadata: metadata as Record<string, unknown>,
      }),
    ];
  }

  const docs: Document[] = [];

  for (let i = 0; i < sections.length; i++) {
    const raw = sections[i]?.trim();
    if (!raw) continue;

    // 第一段可能没有 ## 前缀（# 标题那段）；后面段要补回 ##
    const text = i === 0 ? raw : `## ${raw}`;

    const metadata = chunkMetadataSchema.parse({
      corpusUserId,
      path: repoPath,
      title,
      chunkIndex: i,
    });

    docs.push(
      new Document({
        id: `${corpusUserId}:${repoPath}:${i}`,
        pageContent: text,
        metadata: metadata as Record<string, unknown>,
      })
    );
  }

  return docs;
}
