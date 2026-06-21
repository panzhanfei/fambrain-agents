/**
 * L3/L4：稳定 facetKey（canonical 槽语义，非用户口语）。
 */
import { normalizeSearchQuery } from "@fambrain/infra";
import { inferQueryProfile } from "@/agentflow/agents/online/knowledge-manager/query-profile";
import { canonicalizePlanItem } from "./composite-slot-queries";
import type { CompositeRetrievalSlot } from "./composite-slot-queries";
import type { IntakeRetrievalPlanItem } from "./prompt";

type FacetSource =
    | Pick<
          IntakeRetrievalPlanItem,
          "label" | "searchQuery" | "queryType" | "topics"
      >
    | CompositeRetrievalSlot;

const topicHas = (topics: string[], re: RegExp): boolean =>
    topics.some((t) => re.test(t));

const labelNorm = (label: string): string =>
    normalizeSearchQuery(label).replace(/\s+/g, " ");

/** 用户明确要求重答 composite */
export const detectCompositeRefreshIntent = (userQuestion: string): boolean =>
    /全部重来|重新介绍|重新回答|重新说|再说一遍|从头再来|不对[，,]?重新|重新来/.test(
        userQuestion.trim()
    );

/**
 * 从 plan 槽推导 facetKey。
 * - enumeration：projects / employers 二分
 * - identity：按 label 语义分桶（姓名/年龄/学历/邮箱/电话…）
 */
export const buildFacetKey = (source: FacetSource): string => {
    const item =
        "searchQuery" in source && "queryType" in source
            ? {
                  label: source.label,
                  searchQuery: source.searchQuery,
                  queryType: source.queryType,
                  topics: source.topics,
              }
            : source;

    const canonical = canonicalizePlanItem({
        label: item.label,
        searchQuery: item.searchQuery,
        queryType: item.queryType,
        topics: item.topics,
    });
    const ln = labelNorm(item.label);

    if (canonical.queryType === "enumeration") {
        if (topicHas(canonical.topics, /^project|tech-stack$/)) {
            return "enum:projects";
        }
        if (/职位|角色|担任|岗位|干什么/.test(ln)) {
            return "enum:employers:roles";
        }
        return "enum:employers";
    }

    if (canonical.queryType === "identity") {
        if (/邮箱|邮件|email|e-mail/.test(ln)) return "id:email";
        if (/电话|手机|联系方式|qq|wechat|微信/.test(ln)) return "id:phone";
        if (/姓名|叫什么|名字|全名|我叫什么|我是谁/.test(ln)) return "id:name";
        if (/年龄|多大|几岁|出生|周岁/.test(ln)) return "id:age";
        if (/学历|毕业|院校|专科|本科/.test(ln)) return "id:education";
        if (/行业|职业|从事|领域|方向/.test(ln)) return "id:career";
        return `id:profile:${ln.slice(0, 24) || "general"}`;
    }

    if (canonical.queryType === "tech") {
        return `tech:${ln.slice(0, 32) || "general"}`;
    }

    const inferred = inferQueryProfile(item.label, []);
    if (inferred === "enumeration") {
        return /项目/.test(ln) ? "enum:projects" : "enum:employers";
    }
    return `default:${ln.slice(0, 32) || canonical.queryType}`;
};

export const attachFacetKey = (
    slot: CompositeRetrievalSlot
): CompositeRetrievalSlot & { facetKey: string } => ({
    ...slot,
    facetKey: buildFacetKey(slot),
});
