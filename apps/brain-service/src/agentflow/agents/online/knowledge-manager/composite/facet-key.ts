/**
 * facetKey：会话内「同一语义槽」的稳定键（KM 执行侧）。
 *
 * 用途：
 * - composite 会话 facets[facetKey] 存 Analyst 终稿（槽答案缓存）
 * - 同问不同说法（「叫什么」/「姓名」）应对齐到同一 key（如 id:name）
 *
 * 键按 queryType 分桶：enum:* / id:* / tech:* / default:*
 * 槽位模板仍来自 Intake（canonicalizePlanItem）；本文件只负责算 key。
 */
import { normalizeSearchQuery } from "@fambrain/infra";
import type { CompositeRetrievalSlot } from "@/agentflow/agents/online/intake-coordinator";
import {
    canonicalizePlanItem,
    resolveEnumerationTarget,
} from "@/agentflow/agents/online/intake-coordinator";
import type { IntakeRetrievalPlanItem } from "@/agentflow/agents/online/intake-coordinator/contract";
import { inferQueryProfile } from "../profile/query-profile";

type FacetSource =
    | Pick<
          IntakeRetrievalPlanItem,
          "label" | "searchQuery" | "queryType" | "topics"
      >
    | CompositeRetrievalSlot;

const labelNorm = (label: string): string =>
    normalizeSearchQuery(label).replace(/\s+/g, " ");

/** 用户明确要求重答 → resolveIncrementalCompositePlan 会清会话 cache */
export const detectCompositeRefreshIntent = (userQuestion: string): boolean =>
    /全部重来|重新介绍|重新回答|重新说|再说一遍|从头再来|不对[，,]?重新|重新来/.test(
        userQuestion.trim()
    );

/**
 * 从 plan/槽推导 facetKey。
 * - enumeration → enum:projects | enum:employers | enum:employers:roles
 * - identity → id:name | id:age | …
 * - tech / default → 带 label 前缀的弱键
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
        const target = resolveEnumerationTarget({
            label: item.label,
            searchQuery: canonical.searchQuery,
            topics: canonical.topics,
        });
        if (target === "project") return "enum:projects";
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

    if (canonical.queryType === "external_link") {
        return `link:${ln.slice(0, 32) || "external"}`;
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

/** 给槽挂上 facetKey，供增量计划查槽答案缓存 */
export const attachFacetKey = (
    slot: CompositeRetrievalSlot
): CompositeRetrievalSlot & { facetKey: string } => ({
    ...slot,
    facetKey: buildFacetKey(slot),
});
