/**
 * 语料条目时间窗过滤（相对 asOfDate；解析 path/正文年份与「至今」）。
 * 不绑具体公司/项目名。
 */

const YEAR_RE = /(?:19|20)\d{2}/g;

export const collectEntryYears = (path: string, body: string): number[] => {
    const years = new Set<number>();
    const base = path.split("/").pop() ?? path;
    const pathYear = base.match(/^(?:.*?)((?:19|20)\d{2})[-_]/)?.[1];
    if (pathYear) years.add(Number(pathYear));
    for (const m of body.matchAll(YEAR_RE)) {
        const y = Number(m[0]);
        if (y >= 1970 && y <= 2100) years.add(y);
    }
    return [...years];
};

export const entryOverlapsTimeWindow = (input: {
    path: string;
    body: string;
    timeWindowYears: number;
    asOfDate?: string | null;
}): boolean => {
    const years = Math.max(1, Math.floor(input.timeWindowYears));
    const asOf = input.asOfDate
        ? new Date(`${input.asOfDate}T12:00:00`)
        : new Date();
    const cutoffYear = asOf.getFullYear() - years;
    if (/至今|现在|present/i.test(input.body)) return true;
    const entryYears = collectEntryYears(input.path, input.body);
    if (entryYears.length === 0) return true;
    return entryYears.some((y) => y >= cutoffYear);
};

/** experience 正文「角色 / 职位」结构抽取 */
export const extractRoleFromExperienceBody = (body: string): string | null => {
    const starred = body.match(/\*\*角色\*\*\s*[：:]\s*([^*\n]+)/);
    if (starred?.[1]?.trim()) return starred[1].trim();
    const plain = body.match(/(?:角色|职位|岗位)\s*[：:]\s*([^\n·|]+)/);
    if (plain?.[1]?.trim()) return plain[1].trim().replace(/\*\*/g, "");
    return null;
};
