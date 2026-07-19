/** 列举扫盘 path 判定（与 KM retrieve-helpers 语义一致，避免循环依赖）。 */

export const isExperienceEntryPath = (repoPath: string): boolean => {
    const p = repoPath.replace(/\\/g, "/").toLowerCase();
    if (!p.includes("/experience/")) return false;
    if (p.includes("readme")) return false;
    return /\.md$/i.test(p);
};

export const isProjectEntryPath = (repoPath: string): boolean => {
    const p = repoPath.replace(/\\/g, "/").toLowerCase();
    if (!p.includes("/projects/")) return false;
    if (p.includes("readme") || p.includes("_template")) return false;
    if (p.endsWith("/projects/resume.md")) return false;
    return /\.md$/i.test(p);
};

export const LIST_EXCERPT_MAX = 320;

export const pickListExcerpt = (body: string): string =>
    body.slice(0, LIST_EXCERPT_MAX).trim();
