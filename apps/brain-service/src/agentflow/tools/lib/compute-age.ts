import type { KnowledgeHit } from "@/agentflow/brain-service/online/knowledge-manager";

export type BirthDate = {
    year: number;
    month?: number;
    day?: number;
};

export type AgeExtraction = {
    birth?: BirthDate;
    explicitAge?: number;
    sourceHit?: KnowledgeHit;
    /** 展示用出生描述，如「1993 年 3 月」 */
    birthLabel?: string;
};

const AGE_QUESTION_RE =
    /年龄|出生|多大|几岁|周岁|今年|多大了|哪年.*生|birth|how old|age/i;

const EXPLICIT_AGE_RE =
    /(?:年龄|Age)[：:\s|]*(\d{1,2})\s*(?:岁|years? old)?/i;

const TABLE_BIRTH_RE =
    /\|\s*(?:出生日期|出生年月|生日|出生)\s*\|\s*(\d{4})[./年-](\d{1,2})(?:[./月-](\d{1,2}))?/;

const LABEL_BIRTH_RE =
    /出生(?:日期|年月|时间)?[：:\s|]*(\d{4})[./年-](\d{1,2})(?:[./月-](\d{1,2}))?/;

const BORN_RE = /生于\s*(\d{4})\s*年?\s*(\d{1,2})?\s*月?/;

const INLINE_BIRTH_RE =
    /(?:^|[\s|])(\d{4})[./年-](\d{1,2})(?:[./月-](\d{1,2}))?(?:\s*(?:出生|生))?/;

const TABLE_AGE_RE = /\|\s*年龄\s*\|\s*(\d{1,2})\s*(?:岁)?\s*\|/;

const parseBirthGroups = (
    year: string,
    month?: string,
    day?: string
): BirthDate | null => {
    const y = Number(year);
    const m = month ? Number(month) : undefined;
    const d = day ? Number(day) : undefined;
    if (!Number.isFinite(y) || y < 1900 || y > 2100) return null;
    if (m !== undefined && (m < 1 || m > 12)) return null;
    if (d !== undefined && (d < 1 || d > 31)) return null;
    return { year: y, month: m, day: d };
};

export const formatBirthLabel = (
    birth: BirthDate,
    language: "zh" | "en" | "mixed"
): string => {
    if (language === "en") {
        if (birth.month && birth.day) {
            return `${birth.year}-${String(birth.month).padStart(2, "0")}-${String(birth.day).padStart(2, "0")}`;
        }
        if (birth.month) {
            return `${birth.month}/${birth.year}`;
        }
        return String(birth.year);
    }
    if (birth.month && birth.day) {
        return `${birth.year} 年 ${birth.month} 月 ${birth.day} 日`;
    }
    if (birth.month) {
        return `${birth.year} 年 ${birth.month} 月`;
    }
    return `${birth.year} 年`;
};

/** 周岁（截至 asOf 当日） */
export const computeAgeYears = (
    birth: BirthDate,
    asOf: Date = new Date()
): number => {
    let age = asOf.getFullYear() - birth.year;
    const month = asOf.getMonth() + 1;
    const day = asOf.getDate();
    if (birth.month !== undefined) {
        if (
            month < birth.month ||
            (month === birth.month &&
                birth.day !== undefined &&
                day < birth.day)
        ) {
            age--;
        } else if (birth.day === undefined && month < birth.month) {
            age--;
        }
    }
    return Math.max(0, age);
};

const extractFromLine = (
    line: string
): Pick<AgeExtraction, "birth" | "explicitAge"> => {
    let birth: BirthDate | null = null;
    let explicitAge: number | undefined;

    const tableBirth = line.match(TABLE_BIRTH_RE);
    if (tableBirth) {
        birth = parseBirthGroups(tableBirth[1]!, tableBirth[2], tableBirth[3]);
        if (birth) return { birth };
    }

    const labelBirth = line.match(LABEL_BIRTH_RE);
    if (labelBirth) {
        birth = parseBirthGroups(labelBirth[1]!, labelBirth[2], labelBirth[3]);
        if (birth) return { birth };
    }

    const born = line.match(BORN_RE);
    if (born) {
        birth = parseBirthGroups(born[1]!, born[2]);
        if (birth) return { birth };
    }

    if (/出生|生日|birth/i.test(line)) {
        const inline = line.match(INLINE_BIRTH_RE);
        if (inline) {
            birth = parseBirthGroups(inline[1]!, inline[2], inline[3]);
            if (birth) return { birth };
        }
    }

    const tableAge = line.match(TABLE_AGE_RE);
    if (tableAge) {
        explicitAge = Number(tableAge[1]);
        if (Number.isFinite(explicitAge)) return { explicitAge };
    }

    const explicit = line.match(EXPLICIT_AGE_RE);
    if (explicit) {
        explicitAge = Number(explicit[1]);
        if (Number.isFinite(explicitAge)) return { explicitAge };
    }

    if (/年龄|age/i.test(line)) {
        const ageOnly = line.match(/(\d{1,2})\s*岁/);
        if (ageOnly) {
            explicitAge = Number(ageOnly[1]);
            if (Number.isFinite(explicitAge)) return { explicitAge };
        }
    }

    return {};
};

export const extractBirthOrAgeFromText = (text: string): AgeExtraction => {
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
        const found = extractFromLine(line.trim());
        if (found.birth || found.explicitAge !== undefined) {
            const birthLabel = found.birth
                ? formatBirthLabel(found.birth, "zh")
                : undefined;
            return { ...found, birthLabel };
        }
    }
    return {};
};

/** 优先 personal/resume 路径，再扫全部 hits */
export const extractBirthOrAgeFromHits = (
    hits: KnowledgeHit[]
): AgeExtraction => {
    const sorted = [...hits].sort((a, b) => {
        const score = (p: string) =>
            /personal|简历|resume/i.test(p) ? 0 : 1;
        return score(a.path) - score(b.path);
    });
    for (const hit of sorted) {
        const found = extractBirthOrAgeFromText(hit.excerpt);
        if (found.birth || found.explicitAge !== undefined) {
            return {
                ...found,
                sourceHit: hit,
                birthLabel: found.birth
                    ? formatBirthLabel(found.birth, "zh")
                    : found.birthLabel,
            };
        }
    }
    return {};
};

export const isAgeSubQuestion = (context: string): boolean =>
    AGE_QUESTION_RE.test(context);

export const buildAgeAnswer = (input: {
    extraction: AgeExtraction;
    language: "zh" | "en" | "mixed";
    asOfDate?: string;
}): { answer: string; insufficientEvidence: boolean } => {
    const { extraction, language } = input;
    const asOf = input.asOfDate
        ? new Date(`${input.asOfDate}T12:00:00`)
        : new Date();

    if (extraction.birth) {
        const age = computeAgeYears(extraction.birth, asOf);
        const birthLabel =
            extraction.birthLabel ??
            formatBirthLabel(extraction.birth, language);
        const answer =
            language === "en"
                ? `${age} years old (resume records birth ${birthLabel})`
                : `${age} 岁（简历记载生于 ${birthLabel}）`;
        return { answer, insufficientEvidence: false };
    }

    if (extraction.explicitAge !== undefined) {
        const answer =
            language === "en"
                ? `${extraction.explicitAge} years old (as recorded in the resume excerpt)`
                : `${extraction.explicitAge} 岁（简历原文记载）`;
        return { answer, insufficientEvidence: false };
    }

    const answer =
        language === "en"
            ? "Your knowledge base resume does not record a current age or birth date, so I cannot answer how old you are this year."
            : "个人知识库中的简历未标注当前年龄或出生日期，无法据此回答「今年多大」。";
    return { answer, insufficientEvidence: true };
};
