import { dedupeCitations } from "@/agentflow/brain-service/online/content-organizer";
import { composeEnumerationAnswer } from "@/agentflow/brain-service/online/information-analyst/compose-message";
import type { SubQuestionAnalyzeInput } from "@/agentflow/brain-service/online/information-analyst/analyze-helpers";
import { resolveAnalystQueryProfile } from "@/agentflow/brain-service/online/information-analyst/analyst-recall-limits";
import type { InformationAnalystResult } from "@/agentflow/brain-service/online/information-analyst/prompt";
import {
    buildAgeAnswer,
    extractBirthOrAgeFromHits,
    isAgeSubQuestion,
} from "../lib/compute-age";

/** 主 pipeline Analyst 编排工具（非 LLM ReAct） */
export const ORCHESTRATED_TOOL_IDS = [
    "compose_enumeration",
    "compute_age_from_hits",
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

    if (profile === "identity" && isAgeSubQuestion(ageContext(input))) {
        return "compute_age_from_hits";
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
        case "search_web":
            return null;
        default:
            return null;
    }
};
