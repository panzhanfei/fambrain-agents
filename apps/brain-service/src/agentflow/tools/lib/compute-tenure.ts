/**
 * 从工作经历时间线 excerpt 推算从业年限（确定性，无口语硬编码）。
 * 解析表格/行内「YYYY.MM - YYYY.MM|至今」日期段，取最早起点。
 */
import type { KnowledgeHit } from "@/agentflow/agents/online/knowledge-manager";

export type TenureRange = {
    startYear: number;
    startMonth?: number;
    endYear?: number;
    endMonth?: number;
    ongoing: boolean;
};

export type TenureExtraction = {
    earliest: TenureRange;
    ranges: TenureRange[];
    sourceHit?: KnowledgeHit;
};

const RANGE_RE =
    /(\d{4})(?:[./年-](\d{1,2}))?\s*[-–—~至到]+\s*(?:(\d{4})(?:[./年-](\d{1,2}))?|至今|现在|present)/gi;

export const parseTenureRangesFromText = (text: string): TenureRange[] => {
    const out: TenureRange[] = [];
    for (const m of text.matchAll(RANGE_RE)) {
        const startYear = Number(m[1]);
        if (!Number.isFinite(startYear) || startYear < 1970 || startYear > 2100) {
            continue;
        }
        const startMonth = m[2] ? Number(m[2]) : undefined;
        const endRaw = m[3];
        const ongoing = !endRaw;
        const endYear = endRaw ? Number(endRaw) : undefined;
        const endMonth = m[4] ? Number(m[4]) : undefined;
        out.push({
            startYear,
            startMonth:
                startMonth && startMonth >= 1 && startMonth <= 12
                    ? startMonth
                    : undefined,
            endYear,
            endMonth:
                endMonth && endMonth >= 1 && endMonth <= 12
                    ? endMonth
                    : undefined,
            ongoing,
        });
    }
    return out;
};

const rangeStartKey = (r: TenureRange): number =>
    r.startYear * 100 + (r.startMonth ?? 1);

/** 语料 experience 路径惯例：`experience/2016-公司.md` → 起点年 */
const rangesFromPath = (path: string): TenureRange[] => {
    const base = path.split("/").pop() ?? path;
    const m = base.match(/^(20\d{2})[-_]/);
    if (!m) return [];
    const startYear = Number(m[1]);
    if (!Number.isFinite(startYear)) return [];
    return [{ startYear, ongoing: false }];
};

export const extractTenureFromHits = (
    hits: KnowledgeHit[]
): TenureExtraction | null => {
    const sorted = [...hits].sort((a, b) => {
        const score = (p: string) =>
            /personal|简历|resume|experience|经历/i.test(p) ? 0 : 1;
        return score(a.path) - score(b.path);
    });
    const allRanges: TenureRange[] = [];
    let sourceHit: KnowledgeHit | undefined;
    for (const hit of sorted) {
        const fromText = parseTenureRangesFromText(hit.excerpt);
        const fromPath = /experience/i.test(hit.path)
            ? rangesFromPath(hit.path)
            : [];
        const ranges = [...fromText, ...fromPath];
        if (ranges.length === 0) continue;
        if (!sourceHit || fromText.length > 0) sourceHit = hit;
        allRanges.push(...ranges);
    }
    if (allRanges.length === 0) return null;
    const earliest = [...allRanges].sort(
        (a, b) => rangeStartKey(a) - rangeStartKey(b)
    )[0]!;
    return {
        earliest,
        ranges: allRanges,
        sourceHit,
    };
};

export const computeTenureYearsMonths = (
    start: TenureRange,
    asOf: Date
): { years: number; months: number } => {
    const startMonth = start.startMonth ?? 1;
    let years = asOf.getFullYear() - start.startYear;
    let months = asOf.getMonth() + 1 - startMonth;
    if (months < 0) {
        years -= 1;
        months += 12;
    }
    if (years < 0) return { years: 0, months: 0 };
    return { years, months };
};

export const buildTenureAnswer = (input: {
    extraction: TenureExtraction | null;
    language: "zh" | "en" | "mixed";
    asOfDate?: string;
}): { answer: string; insufficientEvidence: boolean } => {
    const { extraction, language } = input;
    if (!extraction) {
        return {
            answer:
                language === "en"
                    ? "No work-history date ranges were found in the resume excerpts, so years of experience cannot be computed."
                    : "个人知识库简历片段中未解析到工作经历时间段，无法推算从业年限。",
            insufficientEvidence: true,
        };
    }
    const asOf = input.asOfDate
        ? new Date(`${input.asOfDate}T12:00:00`)
        : new Date();
    const { years, months } = computeTenureYearsMonths(
        extraction.earliest,
        asOf
    );
    const y = extraction.earliest.startYear;
    const m = extraction.earliest.startMonth;
    const startLabel =
        m != null
            ? language === "en"
                ? `${y}-${String(m).padStart(2, "0")}`
                : `${y} 年 ${m} 月`
            : language === "en"
              ? `${y}`
              : `${y} 年`;
    if (language === "en") {
        const dur =
            months > 0
                ? `${years} years ${months} months`
                : `${years} years`;
        return {
            answer: `${dur} (earliest resume work history from ${startLabel})`,
            insufficientEvidence: false,
        };
    }
    const dur =
        months > 0 ? `${years} 年 ${months} 个月` : `${years} 年`;
    return {
        answer: `${dur}（简历工作经历最早自 ${startLabel}）`,
        insufficientEvidence: false,
    };
};
