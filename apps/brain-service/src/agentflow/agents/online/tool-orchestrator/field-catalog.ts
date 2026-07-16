import type { IntakeIdentityField } from "@/agentflow/agents/online/intake-coordinator/contract";
import type { ToolRunId } from "./types";

/** 声明式 identity 字段 → 工具映射（由 Intake identityField 索引，无口语 patterns） */
export type IdentityFieldSpec = {
    id: IntakeIdentityField;
    toolId: ToolRunId | null;
    requiresCompute: boolean;
};

export const IDENTITY_FIELD_BY_ID: Record<IntakeIdentityField, IdentityFieldSpec> =
    {
        age: {
            id: "age",
            toolId: "compute_age_from_hits",
            requiresCompute: true,
        },
        name: {
            id: "name",
            toolId: "extract_identity_from_hits",
            requiresCompute: false,
        },
        education: {
            id: "education",
            toolId: null,
            requiresCompute: false,
        },
        career: {
            id: "career",
            toolId: null,
            requiresCompute: false,
        },
        tenure: {
            id: "tenure",
            toolId: "compute_tenure_from_hits",
            requiresCompute: true,
        },
        email: {
            id: "email",
            toolId: null,
            requiresCompute: false,
        },
        phone: {
            id: "phone",
            toolId: null,
            requiresCompute: false,
        },
    };

/** @deprecated 语料表列名常量（非用户问句词表）；供 KM excerpt 使用 */
export const IDENTITY_CORPUS_FIELD_LABELS: Record<
    IntakeIdentityField,
    string[]
> = {
    name: ["姓名", "名字"],
    age: ["出生", "年龄", "出生日期", "出生年月"],
    email: ["邮箱", "邮件", "email"],
    phone: ["电话", "手机", "联系方式"],
    education: ["学历", "毕业", "院校"],
    career: ["行业", "职业", "从事", "领域"],
    tenure: ["工作经历", "时间线", "时间段", "任职"],
};

export const resolveIdentityFieldFromPlan = (input: {
    identityField?: IntakeIdentityField | null;
}): IdentityFieldSpec | null => {
    const id = input.identityField ?? null;
    if (!id) return null;
    return IDENTITY_FIELD_BY_ID[id] ?? null;
};

/**
 * @deprecated 改用 resolveIdentityFieldFromPlan({ identityField })。
 * 无 identityField 时返回 null（不再对 label 做口语正则）。
 */
export const resolveIdentityField = (
    _label: string,
    identityField?: IntakeIdentityField | null
): IdentityFieldSpec | null =>
    resolveIdentityFieldFromPlan({ identityField });

/** topics 含 external → web 源（Intake 声明，非口语词表） */
export const topicsSuggestWebSource = (topics: string[]): boolean =>
    topics.includes("external");

/**
 * @deprecated 改用 topicsSuggestWebSource(topics)。
 */
export const labelSuggestsWebSource = (
    _label: string,
    _searchQuery: string,
    topics: string[] = []
): boolean => topicsSuggestWebSource(topics);

/** Intake topics 含 external 且同时有 corpus 向 topics → hybrid DAG */
export const decisionSuggestsHybridDag = (input: {
    topics: string[];
    planTopics?: string[][];
}): boolean => {
    const all = [
        ...input.topics,
        ...(input.planTopics ?? []).flat(),
    ];
    const hasExternal = all.includes("external");
    const hasCorpus = all.some((t) =>
        ["personal", "resume", "experience", "project", "tech-stack"].includes(
            t
        )
    );
    return hasExternal && hasCorpus;
};

/**
 * @deprecated 改用 decisionSuggestsHybridDag。
 */
export const userQuestionSuggestsHybridDag = (
    _userQuestion: string,
    topics: string[] = []
): boolean => decisionSuggestsHybridDag({ topics });

/** 公司实体：优先 Intake searchQuery（已由 LLM 写入实体），不用口语正则抽 */
export const extractCompanyHint = (
    _userQuestion: string,
    fallback: string
): string => {
    const hint = fallback.trim();
    return hint.length >= 2 ? hint : fallback;
};
