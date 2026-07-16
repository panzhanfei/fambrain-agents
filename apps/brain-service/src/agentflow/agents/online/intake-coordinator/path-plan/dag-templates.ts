/**
 * DAG 模板：仅「多源汇合」一类通用图（语料 + 外部检索 + synthesize）。
 * 禁止再为单个业务场景（如开源链接）新增 named template。
 */
import { extractCompanyHint } from "@/agentflow/agents/online/tool-orchestrator/field-catalog";
import type { ExecutionPlanNode } from "@/agentflow/agents/online/tool-orchestrator";
import type { DagRun, DagTemplateId } from "./interface";

export const DAG_TEMPLATE_IDS: DagTemplateId[] = ["hybrid_multi_source"];

/** 语料简历 + 联网公司/市场 + synthesize（deps 拓扑） */
export const expandHybridMultiSourceTemplate = (
    userQuestion: string,
    searchQuery: string
): ExecutionPlanNode[] => {
    const company = extractCompanyHint(userQuestion, searchQuery);
    const year = new Date().getFullYear();
    return [
        {
            id: "resume",
            label: "个人简历",
            dataSource: "corpus",
            toolId: "retrieve_corpus",
            searchQuery: "个人简介 简历 技能 经历 项目",
            queryType: "identity",
            topics: ["personal", "resume"],
            field: null,
            deps: [],
        },
        {
            id: "company",
            label: "目标公司",
            dataSource: "web",
            toolId: "search_web",
            webQuery: `${company} 公司 业务 招聘 发展 最近`,
            deps: [],
        },
        {
            id: "market",
            label: "市场行情",
            dataSource: "web",
            toolId: "search_web",
            webQuery: `${year} 年 市场行情 行业趋势 招聘`,
            deps: [],
        },
        {
            id: "synthesis",
            label: "综合评估",
            dataSource: "synthesize",
            toolId: "synthesize_merge",
            deps: ["resume", "company", "market"],
        },
    ];
};

/** @deprecated 使用 expandHybridMultiSourceTemplate */
export const expandHybridResumeMarketTemplate = expandHybridMultiSourceTemplate;

export const expandDagTemplate = (
    run: DagRun,
    ctx: {
        userQuestion: string;
        searchQuery: string;
        reuseListStep: boolean;
    }
): ExecutionPlanNode[] => {
    if (run.template === "hybrid_multi_source") {
        return expandHybridMultiSourceTemplate(
            ctx.userQuestion,
            ctx.searchQuery
        );
    }
    return [];
};
