import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getCorpusLearnedDir } from "./doc-paths";
import { toRepoPath } from "./list-markdown-files";

export type LearnedFactFrontmatter = {
    source: "conversation";
    conversationId?: string;
    approvedAt: string;
    approvedByUserId?: string;
    confidence: number;
    factKey: string;
    citations?: string[];
};

export type WriteLearnedFactInput = {
    corpusUserId: string;
    factKey: string;
    label: string;
    value: string;
    confidence: number;
    conversationId?: string;
    approvedByUserId?: string;
    citations?: string[];
};

const slugify = (raw: string): string =>
    raw
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "-")
        .replace(/[^a-z0-9\u4e00-\u9fff-]+/g, "")
        .slice(0, 48) || "fact";

export const buildLearnedMarkdown = (input: WriteLearnedFactInput): string => {
    const now = new Date().toISOString();
    const citationLines =
        input.citations?.length ?
            `\n\n## 引用来源\n\n${input.citations.map((c) => `- \`${c}\``).join("\n")}`
        :   "";
    const metaLines = [
        `source: conversation`,
        input.conversationId ? `conversationId: ${input.conversationId}` : null,
        `approvedAt: ${now}`,
        input.approvedByUserId ? `approvedByUserId: ${input.approvedByUserId}` : null,
        `confidence: ${input.confidence}`,
        `factKey: ${input.factKey}`,
        input.citations?.length ?
            `citations: ${JSON.stringify(input.citations)}`
        :   null,
    ]
        .filter(Boolean)
        .join("\n");
    return `---
${metaLines}
---

# ${input.label}

${input.value.trim()}${citationLines}
`;
};

export const writeLearnedFactToCorpus = async (
    input: WriteLearnedFactInput
): Promise<string> => {
    const month = new Date().toISOString().slice(0, 7);
    const learnedDir = path.join(getCorpusLearnedDir(input.corpusUserId), month);
    await mkdir(learnedDir, { recursive: true });
    const date = new Date().toISOString().slice(0, 10);
    const base = `${date}-${slugify(input.factKey)}-${slugify(input.label)}`;
    let fileName = `${base}.md`;
    let absPath = path.join(learnedDir, fileName);
    let n = 1;
    while (n < 20) {
        try {
            await writeFile(absPath, buildLearnedMarkdown(input), {
                encoding: "utf8",
                flag: "wx",
            });
            return toRepoPath(absPath);
        }
        catch (e) {
            const code = (e as NodeJS.ErrnoException).code;
            if (code !== "EEXIST") throw e;
            n += 1;
            fileName = `${base}-${n}.md`;
            absPath = path.join(learnedDir, fileName);
        }
    }
    await writeFile(absPath, buildLearnedMarkdown(input), "utf8");
    return toRepoPath(absPath);
};
