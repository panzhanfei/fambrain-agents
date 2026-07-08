/**
 * Composite 路由：Intake retrievalPlan 为主信号，结构检测 + queryType 模板为兜底。
 * 不依赖用户问句关键词词表决定槽位。
 */
import { inferQueryProfile } from "@/agentflow/brain-service/online/knowledge-manager/query-profile";
import type { CompositeRetrievalSlot } from "./composite-slot-queries";
import {
    facetTemplateForQueryType,
    IDENTITY_SLOT,
    planItemToSlot,
    PROJECTS_SLOT,
    EMPLOYERS_SLOT,
} from "./composite-slot-queries";
import { resolveEnumerationTarget } from "./enumeration-target";
import type { IntakeRetrievalPlanItem } from "../contract/prompt";
import type { IntakeRoutingDecision } from "../contract/prompt";

export type CompositeRoutePlanSource =
    | "intake_retrieval_plan"
    | "intake_subtasks"
    | "structural_multipart"
    | "query_type_template"
    | "none";

export type ResolvedCompositeRoute = {
    slots: CompositeRetrievalSlot[];
    source: CompositeRoutePlanSource;
};

/** 用户句是否像「多问并列」（结构信号，非语义词表） */
export const looksLikeMultiPartQuestion = (question: string): boolean => {
    const q = question.trim();
    if (!q) return false;
    if (/^\d+[.．、]\s*[^\d]{2,}$/u.test(q)) return false;
    const questionMarks = (q.match(/[？?]/g) ?? []).length;
    if (questionMarks >= 2) return true;
    if (/[，,、；;]|以及|还有|另外|分别/.test(q)) return true;
    if (/\d[.．、].*\d[.．、]/s.test(q)) return true;
    return false;
};

/** 按问号/分句切分（兜底：Intake 未给 retrievalPlan 时） */
export const splitQuestionUnits = (question: string): string[] => {
    const q = question.trim();
    if (!q) return [];
    const parts = q
        .split(/[？?；;]+/)
        .flatMap((chunk) => chunk.split(/[，,、]/))
        .map((s) => s.trim())
        .filter((s) => s.length >= 2);
    return [...new Set(parts)];
};

const defaultTopicsForQueryType = (
    queryType: NonNullable<IntakeRoutingDecision["queryType"]>
): string[] => {
    if (queryType === "identity") return ["personal", "resume"];
    if (queryType === "enumeration") return ["project", "experience"];
    if (queryType === "tech") return ["project", "tech-stack"];
    return [];
};

const inferTopics = (
    queryType: NonNullable<IntakeRoutingDecision["queryType"]>,
    segment: string,
    baseTopics: string[]
): string[] => {
    if (baseTopics.length > 0) return baseTopics;
    if (queryType === "enumeration") {
        return resolveEnumerationTarget({
            label: segment,
            searchQuery: segment,
            topics: [],
        }) === "project"
            ? ["project"]
            : ["experience"];
    }
    const profile = inferQueryProfile(segment, []);
    if (profile === "enumeration") {
        return resolveEnumerationTarget({
            label: segment,
            searchQuery: segment,
            topics: [],
        }) === "project"
            ? ["project"]
            : ["experience"];
    }
    return defaultTopicsForQueryType(queryType);
};

const buildSegmentPlanItem = (
    label: string,
    decision: Pick<
        IntakeRoutingDecision,
        "searchQuery" | "topics" | "queryType"
    >
): IntakeRetrievalPlanItem => {
    const profile = inferQueryProfile(label, []);
    const resolvedType =
        profile !== "default"
            ? profile
            : decision.queryType && decision.queryType !== "default"
              ? decision.queryType
              : "default";
    const base = decision.searchQuery.trim();
    const searchQuery = base ? `${label} ${base}` : label;
    return {
        label,
        searchQuery,
        queryType: resolvedType === "tech" ? "default" : resolvedType,
        topics: inferTopics(resolvedType, label, decision.topics),
    };
};

export const buildFallbackRetrievalPlan = (
    userQuestion: string,
    decision: Pick<
        IntakeRoutingDecision,
        "searchQuery" | "subTasks" | "topics" | "queryType"
    >
): IntakeRetrievalPlanItem[] => {
    if (decision.subTasks.length >= 2) {
        return decision.subTasks.map((label) =>
            buildSegmentPlanItem(label, decision)
        );
    }
    if (!looksLikeMultiPartQuestion(userQuestion)) return [];
    const units = splitQuestionUnits(userQuestion);
    if (units.length < 2) return [];
    return units.map((label) => buildSegmentPlanItem(label, decision));
};

const normalizePlanItems = (
    items: IntakeRetrievalPlanItem[]
): IntakeRetrievalPlanItem[] =>
    items.filter(
        (item) =>
            item.label.trim().length > 0 && item.searchQuery.trim().length > 0
    );

export { normalizePlanItems };

/** Intake queryType 为 default/null 时，从用户句推断有效 queryType */
export const resolveEffectiveQueryType = (
    userQuestion: string,
    decision: Pick<
        IntakeRoutingDecision,
        "queryType" | "subTasks" | "searchQuery"
    >
): NonNullable<IntakeRoutingDecision["queryType"]> | "default" => {
    if (decision.queryType && decision.queryType !== "default") {
        return decision.queryType;
    }
    return inferQueryProfile(userQuestion, [
        ...decision.subTasks,
        decision.searchQuery,
    ]);
};

const topicHas = (topics: string[], re: RegExp): boolean =>
    topics.some((t) => re.test(t));

/**
 * 单问 identity/enumeration：脚本/诊断用；主路由依赖 Intake retrievalPlan + queryType 模板。
 */
export const buildSingleQuestionPlanItem = (
    userQuestion: string,
    decision: Pick<
        IntakeRoutingDecision,
        "queryType" | "topics" | "subTasks" | "searchQuery"
    >
): IntakeRetrievalPlanItem | null => {
    const effectiveType = resolveEffectiveQueryType(userQuestion, decision);
    if (effectiveType !== "identity" && effectiveType !== "enumeration") {
        return null;
    }

    const q = userQuestion.trim();

    if (effectiveType === "identity") {
        if (/姓名|叫什么|名字|全名|我叫什么|我是谁/.test(q)) {
            return {
                label: "姓名",
                searchQuery: "个人简介 简历 姓名 全名",
                queryType: "identity",
                topics: ["personal", "resume"],
            };
        }
        if (/年龄|多大|几岁|出生|周岁|哪年.*生/.test(q)) {
            return {
                label: "年龄",
                searchQuery: "个人简介 简历 年龄 出生年份 出生日期",
                queryType: "identity",
                topics: ["personal", "resume"],
            };
        }
        if (/学历|毕业|院校|专科|本科/.test(q)) {
            return {
                label: "学历",
                searchQuery: "个人简介 简历 学历 毕业院校",
                queryType: "identity",
                topics: ["personal", "resume"],
            };
        }
        if (/邮箱|邮件|email|e-mail/i.test(q)) {
            return {
                label: "邮箱",
                searchQuery: "个人简介 简历 邮箱",
                queryType: "identity",
                topics: ["personal", "resume"],
            };
        }
        if (/电话|手机|联系方式|qq|wechat|微信/.test(q)) {
            return {
                label: "电话",
                searchQuery: "个人简介 简历 电话 手机",
                queryType: "identity",
                topics: ["personal", "resume"],
            };
        }
        if (/行业|职业|从事|领域|方向/.test(q)) {
            return {
                label: "从事行业",
                searchQuery: "个人简介 简历 行业 职业 领域",
                queryType: "identity",
                topics: ["personal", "resume"],
            };
        }
        return {
            label: "个人档案",
            searchQuery: IDENTITY_SLOT.searchQuery,
            queryType: "identity",
            topics: ["personal", "resume"],
        };
    }

    if (
        topicHas(decision.topics, /^project|tech-stack$/) ||
        /项目/.test(q)
    ) {
        return {
            label: "项目经历",
            searchQuery: PROJECTS_SLOT.searchQuery,
            queryType: "enumeration",
            topics: ["project"],
        };
    }
    return {
        label: "工作经历",
        searchQuery: EMPLOYERS_SLOT.searchQuery,
        queryType: "enumeration",
        topics: ["experience"],
    };
};

/** 编排主入口：解析本次应跑哪些检索槽（动态，按需子集） */
export const resolveCompositeRoute = (
    decision: Pick<
        IntakeRoutingDecision,
        | "intent"
        | "searchQuery"
        | "subTasks"
        | "topics"
        | "queryType"
        | "retrievalPlan"
    >,
    userQuestion: string
): ResolvedCompositeRoute => {
    if (decision.intent !== "retrieve_and_answer") {
        return { slots: [], source: "none" };
    }

    const fromIntake = normalizePlanItems(decision.retrievalPlan ?? []);
    if (fromIntake.length >= 1) {
        return {
            slots: fromIntake.map((item, i) => planItemToSlot(item, i)),
            source: "intake_retrieval_plan",
        };
    }

    const fromSubTasks = buildFallbackRetrievalPlan(userQuestion, decision);
    if (fromSubTasks.length >= 2) {
        return {
            slots: fromSubTasks.map((item, i) => planItemToSlot(item, i)),
            source:
                decision.subTasks.length >= 2
                    ? "intake_subtasks"
                    : "structural_multipart",
        };
    }

    const template = facetTemplateForQueryType(
        decision.queryType,
        decision.topics,
        {
            label: userQuestion,
            searchQuery: decision.searchQuery,
            topics: decision.topics,
        }
    );
    if (template) {
        return { slots: [template], source: "query_type_template" };
    }

    const effectiveType = resolveEffectiveQueryType(userQuestion, decision);
    const inferredTemplate = facetTemplateForQueryType(
        effectiveType === "default" ? null : effectiveType,
        effectiveType === "enumeration" && /项目/.test(userQuestion)
            ? ["project"]
            : decision.topics,
        {
            label: userQuestion,
            searchQuery: decision.searchQuery,
            topics: decision.topics,
        }
    );
    if (inferredTemplate) {
        return { slots: [inferredTemplate], source: "query_type_template" };
    }

    return { slots: [], source: "none" };
};

export const isCompositeProfileQuestion = (
    decision: Pick<
        IntakeRoutingDecision,
        | "intent"
        | "searchQuery"
        | "subTasks"
        | "topics"
        | "queryType"
        | "retrievalPlan"
    >,
    userQuestion: string
): boolean => resolveCompositeRoute(decision, userQuestion).slots.length >= 2;

/** tech 单问不应误进 slot/composite */
export const isTechSingleQuestion = (
    userQuestion: string,
    decision: Pick<IntakeRoutingDecision, "queryType" | "searchQuery">
): boolean => {
    if (decision.queryType === "tech") return true;
    return /技术栈|用什么技术|用的什么|框架|数据库|架构/i.test(
        `${userQuestion} ${decision.searchQuery}`
    );
};
