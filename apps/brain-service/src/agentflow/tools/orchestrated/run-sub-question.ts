import { dedupeCitations } from "@/agentflow/agents/online/content-organizer";
import { composeEnumerationAnswer } from "@/agentflow/agents/online/information-analyst/compose-message";
import type { SubQuestionAnalyzeInput } from "@/agentflow/agents/online/information-analyst/analyze-helpers";
import { resolveAnalystQueryProfile } from "@/agentflow/agents/online/information-analyst/analyst-recall-limits";
import type { InformationAnalystResult } from "@/agentflow/agents/online/information-analyst/prompt";
import {
    buildAgeAnswer,
    extractBirthOrAgeFromHits,
    isAgeSubQuestion,
} from "../lib/compute-age";
import {
    buildIdentityFieldAnswer,
    extractIdentityFieldFromHits,
} from "../lib/extract-identity-field";
import {
    buildExternalLinksAnswer,
    extractExternalLinksFromHits,
} from "../lib/extract-external-links";
import {
    buildTenureAnswer,
    extractTenureFromHits,
} from "../lib/compute-tenure";
import { resolveIdentityFieldFromPlan } from "@/agentflow/agents/online/tool-orchestrator/field-catalog";

/** 主 pipeline Analyst 编排工具（非 LLM ReAct） */
export const ORCHESTRATED_TOOL_IDS = [
    "compose_enumeration",
    "compute_age_from_hits",
    "compute_tenure_from_hits",
    "extract_identity_from_hits",
    "extract_external_links_from_hits",
    /** 预留：外部事实（公司背景等），Intake external 分支未来接入 */
    "search_web",
] as const;

export type OrchestratedToolId = (typeof ORCHESTRATED_TOOL_IDS)[number];

const ageContext = (input: SubQuestionAnalyzeInput): string =>
    [input.userQuestion, ...(input.topics ?? [])].join(" ");

/** 命中则跳过 Analyst LLM，改走确定性编排工具 */
export const resolveOrchestratedTool = (
    input: SubQuestionAnalyzeInput
): OrchestratedToolId | null => {
    if (input.hits.length === 0 || input.coverage === "none") return null;

    const profile =
        input.queryType ??
        resolveAnalystQueryProfile({
            userQuestion: input.userQuestion,
            subTasks: [input.userQuestion],
        });

    if (profile === "enumeration") return "compose_enumeration";

    if (profile === "external_link") return "extract_external_links_from_hits";

    if (profile === "identity") {
        const fieldSpec = resolveIdentityFieldFromPlan({
            identityField: input.identityField ?? null,
        });
        if (fieldSpec?.toolId === "compute_tenure_from_hits") {
            return "compute_tenure_from_hits";
        }
        if (fieldSpec?.toolId === "compute_age_from_hits") {
            return "compute_age_from_hits";
        }
        if (fieldSpec?.toolId === "extract_identity_from_hits") {
            return "extract_identity_from_hits";
        }
        if (isAgeSubQuestion(ageContext(input))) {
            return "compute_age_from_hits";
        }
    }

    return null;
};

const computeAgeFromHits = (
    input: SubQuestionAnalyzeInput
): InformationAnalystResult => {
    const extraction = extractBirthOrAgeFromHits(input.hits);
    const { answer, insufficientEvidence } = buildAgeAnswer({
        extraction,
        language: input.language,
        asOfDate: input.asOfDate,
    });
    const citations =
        insufficientEvidence || !extraction.sourceHit
            ? []
            : dedupeCitations([
                  {
                      path: extraction.sourceHit.path,
                      excerpt: extraction.sourceHit.excerpt,
                  },
              ]);
    return {
        answer,
        citations,
        confidence: insufficientEvidence ? 0.85 : 0.9,
        insufficientEvidence,
    };
};

const computeTenureFromHits = (
    input: SubQuestionAnalyzeInput
): InformationAnalystResult => {
    const extraction = extractTenureFromHits(input.hits);
    const { answer, insufficientEvidence } = buildTenureAnswer({
        extraction,
        language: input.language,
        asOfDate: input.asOfDate,
    });
    const citations =
        extraction?.sourceHit && !insufficientEvidence
            ? dedupeCitations([
                  {
                      path: extraction.sourceHit.path,
                      excerpt: extraction.sourceHit.excerpt,
                  },
              ])
            : [];
    return {
        answer,
        citations,
        confidence: insufficientEvidence ? 0.85 : 0.9,
        insufficientEvidence,
    };
};

const extractIdentityFromHits = (
    input: SubQuestionAnalyzeInput
): InformationAnalystResult => {
    const field =
        input.identityField ??
        resolveIdentityFieldFromPlan({ identityField: null })?.id ??
        "name";
    const resolvedField =
        field === "name" ||
        field === "age" ||
        field === "email" ||
        field === "phone" ||
        field === "education" ||
        field === "career"
            ? field
            : "name";
    const extraction = extractIdentityFieldFromHits(input.hits, resolvedField);
    const { answer, insufficientEvidence } = buildIdentityFieldAnswer({
        field: resolvedField,
        extraction,
        language: input.language,
    });
    const citations =
        extraction?.sourceHit && !insufficientEvidence
            ? dedupeCitations([
                  {
                      path: extraction.sourceHit.path,
                      excerpt: extraction.sourceHit.excerpt,
                  },
              ])
            : [];
    return {
        answer,
        citations,
        confidence: insufficientEvidence ? 0.85 : 0.92,
        insufficientEvidence,
    };
};

const extractExternalLinksFromHitsResult = (
    input: SubQuestionAnalyzeInput
): InformationAnalystResult => {
    const links = extractExternalLinksFromHits(input.hits);
    const { answer, insufficientEvidence } = buildExternalLinksAnswer({
        links,
        language: input.language,
    });
    const citations = dedupeCitations(
        links.slice(0, 6).map((l) => ({ path: l.path, excerpt: l.url }))
    );
    return {
        answer,
        citations,
        confidence: insufficientEvidence ? 0.85 : 0.9,
        insufficientEvidence,
    };
};

/** 运行编排工具；无匹配返回 null */
export const runOrchestratedSubQuestion = (
    input: SubQuestionAnalyzeInput
): InformationAnalystResult | null => {
    const toolId = resolveOrchestratedTool(input);
    if (!toolId) return null;

    switch (toolId) {
        case "compose_enumeration":
            return composeEnumerationAnswer({
                hits: input.hits,
                language: input.language,
                topics: input.topics ?? [],
                label: input.userQuestion,
                enumerationMeta: input.enumerationMeta,
                notes: input.notes,
                listIntent: input.listIntent,
            });
        case "compute_age_from_hits":
            return computeAgeFromHits(input);
        case "compute_tenure_from_hits":
            return computeTenureFromHits(input);
        case "extract_identity_from_hits":
            return extractIdentityFromHits(input);
        case "extract_external_links_from_hits":
            return extractExternalLinksFromHitsResult(input);
        case "search_web":
            return null;
        default:
            return null;
    }
};
