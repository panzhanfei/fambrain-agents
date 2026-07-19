import type { KnowledgeHit } from "@/agentflow/agents/online/knowledge-manager";

const URL_RE = /https?:\/\/[^\s)>\]"']+/gi;

export type ExtractedLink = {
    url: string;
    path: string;
    excerpt: string;
    /** 展示名：优先 excerpt 邻近实体 / 仓库名，非文件名 */
    title: string;
};

/** Intake 槽 label（结构化子问文案，非用户口语 regex） */
export type ExternalLinkScope = {
    label?: string;
};

const GENERIC_SCOPE_TERMS =
    /^(?:GitHub|gitlab|gitee|开源|开源链接|链接|地址|URL|仓库|项目|项目的|对外|线上|线上链接|预览|部署|上线|是什么|什么|的|与|和|及|跟|请|给|我|你|他|她|它|这|那|哪些|哪个|几个|全部|所有|都|开源项目|仓库地址|线上地址|线上预览|开源链接|github|gitlab|gitee)$/i;

/** 结构信号：泛指「全部/都给我」列举多个链接（非项目名） */
const PLURAL_LIST_SCOPE_RE = /都给我|都要|全都|全部|所有|哪些|几个|两款|两个/u;

/** 从 label 去掉 GitHub/开源/链接 等泛词，剩余视为点名实体 */
const GENERIC_SCOPE_PHRASES = [
    "个人简介",
    "简历",
    "开源项目",
    "开源链接",
    "开源",
    "对外链接",
    "仓库地址",
    "线上预览",
    "线上地址",
    "线上链接",
    "GitHub",
    "gitlab",
    "gitee",
    "链接",
    "地址",
    "仓库",
    "项目",
    "URL",
    "都给我",
    "给我",
    "是什么",
    "什么",
    "全部",
    "所有",
    "哪些",
    "几个",
    "我",
    "你",
    "的",
    "与",
    "和",
    "及",
    "跟",
    "都",
] as const;

const stripGenericScopeText = (text: string): string => {
    let s = text;
    for (const phrase of GENERIC_SCOPE_PHRASES) {
        s = s.replace(new RegExp(phrase, "gi"), " ");
    }
    return s
        .split(/[\s，,、？?！!。.：:；;（）()【】\[\]"'「」]+/)
        .map((part) => part.trim())
        .filter((part) => part.length >= 2)
        .join(" ")
        .trim();
};

/** 泛指多个开源链接（非单项目点名） */
export const scopeRequestsMultipleLinks = (
    scope?: ExternalLinkScope
): boolean => {
    const label = scopeLabel(scope);
    if (!label) return false;
    if (!PLURAL_LIST_SCOPE_RE.test(label)) return false;
    return stripGenericScopeText(label).length === 0;
};

const tokenizeScopeLabel = (label: string): string[] => {
    const spaced = label
        .replace(/([a-zA-Z0-9]+)/g, " $1 ")
        .replace(/([^\x00-\x7F])/g, " $1 ")
        .replace(/\s+/g, " ")
        .trim();
    return spaced.split(/\s+/).map((t) => t.trim()).filter(Boolean);
};

const isGenericScopeToken = (token: string): boolean => {
    const normalized = token.replace(/[？?]+$/u, "").replace(/是什么$/u, "");
    if (GENERIC_SCOPE_TERMS.test(normalized)) return true;
    const withoutDe = normalized.replace(/的$/u, "");
    if (withoutDe !== normalized && GENERIC_SCOPE_TERMS.test(withoutDe)) {
        return true;
    }
    return false;
};

const ONLINE_SCOPE_RE = /线上|预览|部署|上线/i;
const REPO_SCOPE_RE = /github|gitlab|gitee/i;
const REPO_HOST_RE = /github\.com|gitlab\.com|gitee\.com/i;

const scopeLabel = (scope?: ExternalLinkScope): string =>
    scope?.label?.trim() ?? "";

/** 子问 label 是否同时要「线上/预览/部署」类 URL */
export const scopeRequestsOnlineUrls = (scope?: ExternalLinkScope): boolean =>
    ONLINE_SCOPE_RE.test(scopeLabel(scope));

/** 子问 label 是否只要 GitHub/GitLab/Gitee 仓库链接（未同时要线上） */
export const scopeRequestsRepoHostOnly = (scope?: ExternalLinkScope): boolean => {
    const label = scopeLabel(scope);
    if (!label) return false;
    return REPO_SCOPE_RE.test(label) && !scopeRequestsOnlineUrls(scope);
};

/** 从 Intake label 提取实体 token（去掉 GitHub/链接/项目 等泛词） */
export const extractExternalLinkEntityTokens = (
    scope?: ExternalLinkScope
): string[] => {
    const label = scopeLabel(scope);
    if (!label) return [];
    if (scopeRequestsMultipleLinks(scope)) return [];

    const remains = stripGenericScopeText(label);
    if (remains) {
        const seen = new Set<string>();
        const tokens: string[] = [];
        for (const token of remains.split(/\s+/)) {
            if (token.length < 2 || isGenericScopeToken(token)) continue;
            const key = token.toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            tokens.push(token);
        }
        if (tokens.length > 0) return tokens;
    }

    const seen = new Set<string>();
    const tokens: string[] = [];
    for (const raw of tokenizeScopeLabel(label)) {
        const token = raw.trim();
        if (token.length < 2) continue;
        if (isGenericScopeToken(token)) continue;
        const key = token.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        tokens.push(token);
    }
    return tokens;
};

/** Intake label 误套模板时，用原问补全 scope（仅链接抽取，不参与路由） */
export const resolveExternalLinkScope = (
    slotLabel: string,
    parentUserQuestion?: string
): ExternalLinkScope => {
    const slot = slotLabel.trim();
    const parent = parentUserQuestion?.trim() ?? "";
    if (!parent) return { label: slot };

    const slotScope = { label: slot };
    const parentScope = { label: parent };

    if (
        scopeRequestsRepoHostOnly(parentScope) &&
        scopeRequestsOnlineUrls(slotScope)
    ) {
        return parentScope;
    }

    const parentEntities = extractExternalLinkEntityTokens(parentScope);
    const slotEntities = extractExternalLinkEntityTokens(slotScope);
    if (
        parentEntities.length > 0 &&
        slotEntities.length === 0 &&
        scopeRequestsRepoHostOnly(parentScope) &&
        !scopeRequestsMultipleLinks(parentScope)
    ) {
        return parentScope;
    }

    return { label: slot || parent };
};

const isRepoHostUrl = (url: string): boolean => {
    try {
        return REPO_HOST_RE.test(new URL(url).hostname);
    } catch {
        return REPO_HOST_RE.test(url);
    }
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

const linkMatchesEntityTokens = (
    link: ExtractedLink,
    tokens: string[]
): boolean => {
    if (tokens.length === 0) return true;

    const urlLine =
        link.excerpt
            .split(/\r?\n/)
            .find(
                (line) =>
                    line.includes(link.url) ||
                    line.toLowerCase().includes(link.url.toLowerCase())
            ) ?? link.excerpt;

    const haystack = [
        link.title,
        repoNameFromUrl(link.url) ?? "",
        link.url,
        urlLine,
        sourceLabelFromPath(link.path),
    ]
        .join(" ")
        .toLowerCase();
    return tokens.some((token) => haystack.includes(token.toLowerCase()));
};

/** 按 Intake label 过滤：GitHub-only / 点名实体 */
export const filterExternalLinksByScope = (
    links: ExtractedLink[],
    scope?: ExternalLinkScope
): ExtractedLink[] => {
    if (!scope || links.length === 0) return links;

    const entityTokens = extractExternalLinkEntityTokens(scope);
    const repoHostOnly = scopeRequestsRepoHostOnly(scope);
    if (entityTokens.length === 0 && !repoHostOnly) return links;

    return links.filter((link) => {
        if (repoHostOnly && !isRepoHostUrl(link.url)) return false;
        return linkMatchesEntityTokens(link, entityTokens);
    });
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
    hits: KnowledgeHit[],
    scope?: ExternalLinkScope
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
    return filterExternalLinksByScope(links, scope);
};

export const buildExternalLinksAnswer = (input: {
    links: ExtractedLink[];
    language: "zh" | "en" | "mixed";
    scope?: ExternalLinkScope;
}): { answer: string; insufficientEvidence: boolean } => {
    const { links, language, scope } = input;
    if (links.length === 0) {
        const entityHint = extractExternalLinkEntityTokens(scope)
            .slice(0, 2)
            .join(" / ");
        const repoHostOnly = scopeRequestsRepoHostOnly(scope);
        return {
            answer:
                language === "en"
                    ? entityHint
                        ? repoHostOnly
                            ? `No GitHub/GitLab/Gitee URL for "${entityHint}" was found in the retrieved excerpts.`
                            : `No public URL for "${entityHint}" was found in the retrieved excerpts.`
                        : repoHostOnly
                          ? "No GitHub/GitLab/Gitee URLs were found in the retrieved excerpts."
                          : "No public URLs were found in the retrieved resume or project excerpts."
                    : entityHint
                      ? repoHostOnly
                          ? `检索片段中未找到与「${entityHint}」相关的 GitHub 公开仓库链接。`
                          : `检索片段中未找到与「${entityHint}」相关的对外公开 URL。`
                      : repoHostOnly
                        ? "检索片段中未找到 GitHub/GitLab/Gitee 仓库链接。"
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
