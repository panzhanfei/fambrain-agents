/**
 * identityField → 展示名 + 检索模板（schema→执行映射，禁止用 labels 猜用户问句）。
 */
import type { IntakeIdentityField } from "@/agentflow/agents/online/intake-coordinator/contract";

export type IdentityFieldSearchSpec = {
    /** 无 LLM label 时的展示名（非口语匹配词表） */
    displayLabel: string;
    searchQuery: string;
};

export const IDENTITY_FIELD_SEARCH: Record<
    IntakeIdentityField,
    IdentityFieldSearchSpec
> = {
    name: {
        displayLabel: "姓名",
        searchQuery: "个人简介 简历 姓名 全名",
    },
    age: {
        displayLabel: "年龄",
        searchQuery: "个人简介 简历 年龄 出生年份 出生日期",
    },
    email: {
        displayLabel: "邮箱",
        searchQuery: "个人简介 简历 邮箱",
    },
    phone: {
        displayLabel: "电话",
        searchQuery: "个人简介 简历 电话 手机",
    },
    education: {
        displayLabel: "学历",
        searchQuery: "个人简介 简历 学历 毕业院校",
    },
    career: {
        displayLabel: "从事行业",
        searchQuery: "个人简介 简历 行业 职业 领域",
    },
    tenure: {
        displayLabel: "从业年限",
        searchQuery: "个人简介 简历 工作经历 时间线 任职 时间段",
    },
};
