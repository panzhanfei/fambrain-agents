import type { ToolRunId } from "./types";

/** 声明式 identity 字段 → 工具映射（扩展时只改此表） */
export type IdentityFieldSpec = {
    id: string;
    labelPatterns: RegExp[];
    toolId: ToolRunId | null;
    requiresCompute: boolean;
};

export const IDENTITY_FIELD_CATALOG: IdentityFieldSpec[] = [
    {
        id: "age",
        labelPatterns: [/年龄/, /多大/, /几岁/, /周岁/, /今年/, /多大了/],
        toolId: "compute_age_from_hits",
        requiresCompute: true,
    },
    {
        id: "name",
        labelPatterns: [/姓名/, /叫什么/, /名字/, /全名/, /我叫什么/],
        toolId: null,
        requiresCompute: false,
    },
    {
        id: "education",
        labelPatterns: [/学历/, /毕业/, /院校/],
        toolId: null,
        requiresCompute: false,
    },
    {
        id: "industry",
        labelPatterns: [/行业/, /从事/, /职业/, /领域/],
        toolId: null,
        requiresCompute: false,
    },
];

const WEB_LABEL_PATTERNS =
    /行情|市场|最近|新闻|怎么样|动态|背景|招聘|融资|公司情况|外界|外部/;

const HYBRID_EVAL_PATTERNS =
    /评估|机会|适不适合|匹配度|去.*公司|入职.*机会/;

export const resolveIdentityField = (label: string): IdentityFieldSpec | null => {
    const ln = label.trim();
    if (!ln) return null;
    return (
        IDENTITY_FIELD_CATALOG.find((f) =>
            f.labelPatterns.some((re) => re.test(ln))
        ) ?? null
    );
};

export const labelSuggestsWebSource = (label: string, searchQuery: string): boolean =>
    WEB_LABEL_PATTERNS.test(`${label} ${searchQuery}`);

export const userQuestionSuggestsHybridDag = (userQuestion: string): boolean => {
    const q = userQuestion.trim();
    if (!HYBRID_EVAL_PATTERNS.test(q)) return false;
    return /简历|我的|个人|技能|经历/.test(q) && /行情|市场|公司|外部/.test(q);
};

/** 从混合问句提取公司名（简单实体抽取，失败则回退 searchQuery） */
export const extractCompanyHint = (
    userQuestion: string,
    fallback: string
): string => {
    const m =
        userQuestion.match(/去\s*([^\s，,。?？]+?)\s*公司/) ??
        userQuestion.match(/([^\s，,。?？]+)\s*公司/);
    const hint = m?.[1]?.trim();
    return hint && hint.length >= 2 ? hint : fallback;
};
