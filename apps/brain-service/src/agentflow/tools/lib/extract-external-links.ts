import type { KnowledgeHit } from "@/agentflow/agents/online/knowledge-manager";

const URL_RE = /https?:\/\/[^\s)>\]"']+/gi;

export type ExtractedLink = {
    url: string;
    path: string;
    excerpt: string;
    /** 展示名：优先 excerpt 邻近实体 / 仓库名，非文件名 */
    title: string;
};

const normalizeUrl = (raw: string): string => raw.replace(/[.,;]+$/g, "");

export const extractUrlsFromText = (text: string): string[] => {
    const matches = text.match(URL_RE) ?? [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const m of matches) {
        const url = normalizeUrl(m);
        if (!url || seen.has(url)) continue;
        seen.add(url);
        out.push(url);
    }
    return out;
};

const sourceLabelFromPath = (path: string): string =>
    path.split("/").pop()?.replace(/\.md$/i, "") ?? path;

/** github.com/owner/repo → repo */
const repoNameFromUrl = (url: string): string | null => {
    try {
        const u = new URL(url);
        if (!/github\.com|gitlab\.com|gitee\.com/i.test(u.hostname)) return null;
        const parts = u.pathname.split("/").filter(Boolean);
        if (parts.length >= 2) {
            return decodeURIComponent(parts[1]!).replace(/\.git$/i, "");
        }
    } catch {
        /* ignore */
    }
    return null;
};

/**
 * 从含 URL 的行推断展示名（markdown 链接文案 / 行首实体），无项目名单硬编码。
 */
export const resolveLinkTitle = (
    url: string,
    excerpt: string
): string | null => {
    const lines = excerpt.split(/\r?\n/);
    for (const line of lines) {
        if (!line.includes(url) && !line.toLowerCase().includes(url.toLowerCase())) {
            continue;
        }

        const md = [...line.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/gi)];
        for (const m of md) {
            const label = m[1]?.trim();
            const href = m[2] ? normalizeUrl(m[2]) : "";
            if (!label || href !== url) continue;
            if (/^https?:\/\//i.test(label)) continue;
            if (label.includes("/")) {
                const last = label.split("/").pop()?.trim();
                if (last) return last;
            }
            return label;
        }

        const before = line.split(url)[0] ?? "";
        const cleaned = before
            .replace(/^[\s-*•|]+/, "")
            .replace(/\*\*/g, "")
            .replace(
                /(?:GitHub|gitlab|gitee|线上预览|对外链接|仓库地址|仓库|URL|链接)/gi,
                ""
            )
            .replace(/[：:\s|<（(]+$/g, "")
            .trim();
        if (cleaned.length >= 2 && cleaned.length <= 48) return cleaned;
    }
    return repoNameFromUrl(url);
};

const linkScore = (hit: KnowledgeHit): number => {
    let s = 0;
    if (/personal|resume|简历/i.test(hit.path)) s += 3;
    if (/https?:\/\//i.test(hit.excerpt)) s += 5;
    if (/github\.com|gitlab\.com|gitee\.com/i.test(hit.excerpt)) s += 2;
    return s;
};

/** 从 hits excerpt 确定性抽取 URL（不依赖项目名硬编码） */
export const extractExternalLinksFromHits = (
    hits: KnowledgeHit[]
): ExtractedLink[] => {
    const sorted = [...hits].sort((a, b) => linkScore(b) - linkScore(a));
    const seen = new Set<string>();
    const links: ExtractedLink[] = [];
    for (const hit of sorted) {
        for (const url of extractUrlsFromText(hit.excerpt)) {
            if (seen.has(url)) continue;
            seen.add(url);
            const title =
                resolveLinkTitle(url, hit.excerpt) ??
                repoNameFromUrl(url) ??
                sourceLabelFromPath(hit.path);
            links.push({
                url,
                path: hit.path,
                excerpt: hit.excerpt,
                title,
            });
        }
    }
    return links;
};

export const buildExternalLinksAnswer = (input: {
    links: ExtractedLink[];
    language: "zh" | "en" | "mixed";
}): { answer: string; insufficientEvidence: boolean } => {
    const { links, language } = input;
    if (links.length === 0) {
        return {
            answer:
                language === "en"
                    ? "No public URLs were found in the retrieved resume or project excerpts."
                    : "检索片段中未找到对外公开 URL（如 GitHub 或线上预览地址）。",
            insufficientEvidence: true,
        };
    }
    const lines = links.map((l, i) => {
        const source = sourceLabelFromPath(l.path);
        const showSource = source !== l.title;
        if (language === "en") {
            return showSource
                ? `${i + 1}. ${l.title}: ${l.url} (source: ${source})`
                : `${i + 1}. ${l.title}: ${l.url}`;
        }
        return showSource
            ? `${i + 1}. ${l.title}：${l.url}（来源：${source}）`
            : `${i + 1}. ${l.title}：${l.url}`;
    });
    return {
        answer: lines.join("\n"),
        insufficientEvidence: false,
    };
};
