/**
 * facetKey：会话内「同一语义槽」的稳定键（KM 执行侧）。
 *
 * 用途：
 * - composite 会话 facets[facetKey] 存 Analyst 终稿（槽答案缓存）
 * - 同问不同说法应对齐到同一 key（如 id:name）
 *
 * 键按 queryType 分桶：enum:* / id:* / tech:* / link:* / default:*
 * 槽位模板仍来自 Intake（canonicalizePlanItem）；本文件只负责算 key。
 * identity / enumeration 子类信 identityField / listKind / topics，不用口语正则。
 */
import { normalizeSearchQuery } from "@fambrain/infra";
import type { CompositeRetrievalSlot } from "@/agentflow/agents/online/intake-coordinator";
import {
    canonicalizePlanItem,
    resolveEnumerationTarget,
} from "@/agentflow/agents/online/intake-coordinator";
import type {
    IntakeIdentityField,
    IntakeRetrievalPlanItem,
} from "@/agentflow/agents/online/intake-coordinator/contract";

type FacetSource =
    | Pick<
          IntakeRetrievalPlanItem,
          | "label"
          | "searchQuery"
          | "queryType"
          | "topics"
          | "enumerationControl"
          | "identityField"
      >
    | CompositeRetrievalSlot;

const labelNorm = (label: string): string =>
    normalizeSearchQuery(label).replace(/\s+/g, " ");

/** 用户明确要求重答 → resolveIncrementalCompositePlan 会清会话 cache */
export const detectCompositeRefreshIntent = (userQuestion: string): boolean =>
    /全部重来|重新介绍|重新回答|重新说|再说一遍|从头再来|不对[，,]?重新|重新来/.test(
        userQuestion.trim()
    );

const IDENTITY_FACET_KEY: Record<IntakeIdentityField, string> = {
    name: "id:name",
    age: "id:age",
    email: "id:email",
    phone: "id:phone",
    education: "id:education",
    career: "id:career",
    tenure: "id:tenure",
};

/**
 * 从 plan/槽推导 facetKey。
 * - enumeration → enum:projects | enum:employers
 * - identity → id:name | id:age | …（信 identityField）
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
                  enumerationControl:
                      "enumerationControl" in source
                          ? source.enumerationControl
                          : null,
                  identityField:
                      "identityField" in source
                          ? source.identityField
                          : null,
              }
            : source;

    const canonical = canonicalizePlanItem({
        label: item.label,
        searchQuery: item.searchQuery,
        queryType: item.queryType,
        topics: item.topics,
        enumerationControl: item.enumerationControl ?? null,
        identityField: item.identityField ?? null,
    });
    const ln = labelNorm(item.label);

    if (canonical.queryType === "enumeration") {
        const target = resolveEnumerationTarget({
            label: item.label,
            searchQuery: canonical.searchQuery,
            topics: canonical.topics,
            listKind: item.enumerationControl?.listKind ?? null,
        });
        if (target === "project") return "enum:projects";
        return "enum:employers";
    }

    if (canonical.queryType === "identity") {
        const field = canonical.identityField ?? item.identityField ?? null;
        if (field && IDENTITY_FACET_KEY[field]) {
            return IDENTITY_FACET_KEY[field];
        }
        return `id:profile:${ln.slice(0, 24) || "general"}`;
    }

    if (canonical.queryType === "external_link") {
        return `link:${ln.slice(0, 32) || "external"}`;
    }

    if (canonical.queryType === "tech") {
        return `tech:${ln.slice(0, 32) || "general"}`;
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
