import type { IntakeIdentityField } from "@/agentflow/agents/online/intake-coordinator/contract";
import { IDENTITY_CORPUS_FIELD_LABELS } from "@/agentflow/agents/online/tool-orchestrator/field-catalog";
import type { KnowledgeHit } from "@/agentflow/agents/online/knowledge-manager";

export type IdentityFieldExtraction = {
    value: string;
    sourceHit?: KnowledgeHit;
};

const EMPTY_CELL = /^[-—–/\\s]*$/;

const parseTableRow = (
    line: string,
    labels: string[]
): string | null => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return null;
    const cells = trimmed
        .slice(1, -1)
        .split("|")
        .map((c) => c.trim());
    if (cells.length < 2) return null;
    const rowLabel = cells[0] ?? "";
    const value = cells[1] ?? "";
    if (!value || EMPTY_CELL.test(value)) return null;
    if (!labels.some((l) => rowLabel.includes(l))) return null;
    return value;
};

const parseLabelLine = (line: string, labels: string[]): string | null => {
    const trimmed = line.trim();
    for (const lbl of labels) {
        const re = new RegExp(
            `(?:^|[\\s|])${lbl}[：:\\s|]+([^|\\n]+)`,
            "i"
        );
        const m = trimmed.match(re);
        const value = m?.[1]?.trim();
        if (value && !EMPTY_CELL.test(value)) return value;
    }
    return null;
};

/** 从 excerpt 提取 identity 字段（语料表头来自 field-catalog） */
export const extractIdentityFieldFromText = (
    text: string,
    field: IntakeIdentityField
): string | null => {
    const labels = IDENTITY_CORPUS_FIELD_LABELS[field];
    for (const line of text.split(/\r?\n/)) {
        const fromTable = parseTableRow(line, labels);
        if (fromTable) return fromTable;
        const fromLabel = parseLabelLine(line, labels);
        if (fromLabel) return fromLabel;
    }
    return null;
};

export const extractIdentityFieldFromHits = (
    hits: KnowledgeHit[],
    field: IntakeIdentityField
): IdentityFieldExtraction | null => {
    const sorted = [...hits].sort((a, b) => {
        const score = (p: string) => (/personal|简历|resume/i.test(p) ? 0 : 1);
        return score(a.path) - score(b.path);
    });
    for (const hit of sorted) {
        const value = extractIdentityFieldFromText(hit.excerpt, field);
        if (value) return { value, sourceHit: hit };
    }
    return null;
};

export const buildIdentityFieldAnswer = (input: {
    field: IntakeIdentityField;
    extraction: IdentityFieldExtraction | null;
    language: "zh" | "en" | "mixed";
}): { answer: string; insufficientEvidence: boolean } => {
    const { field, extraction, language } = input;
    if (!extraction?.value) {
        const empty: Record<IntakeIdentityField, { zh: string; en: string }> = {
            name: {
                zh: "个人知识库中的简历未检索到姓名。",
                en: "No name was found in your personal knowledge base resume.",
            },
            age: {
                zh: "个人知识库中的简历未标注当前年龄或出生日期。",
                en: "No age or birth date was found in the resume excerpt.",
            },
            email: {
                zh: "个人知识库中的简历未检索到邮箱。",
                en: "No email was found in the resume excerpt.",
            },
            phone: {
                zh: "个人知识库中的简历未检索到电话。",
                en: "No phone number was found in the resume excerpt.",
            },
            education: {
                zh: "个人知识库中的简历未检索到学历信息。",
                en: "No education info was found in the resume excerpt.",
            },
            career: {
                zh: "个人知识库中的简历未检索到行业/职业信息。",
                en: "No career/industry info was found in the resume excerpt.",
            },
            tenure: {
                zh: "个人知识库简历片段中未解析到工作经历时间段，无法推算从业年限。",
                en: "No work-history date ranges were found for tenure.",
            },
        };
        const msg = empty[field];
        return {
            answer: language === "en" ? msg.en : msg.zh,
            insufficientEvidence: true,
        };
    }
    return {
        answer: extraction.value,
        insufficientEvidence: false,
    };
};
