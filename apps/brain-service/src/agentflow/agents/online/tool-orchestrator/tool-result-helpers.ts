import type { InformationAnalystResult } from "@/agentflow/agents/online/information-analyst/prompt";
import { resolveAnalystQueryProfile } from "@/agentflow/agents/online/information-analyst/analyst-recall-limits";
import type { SubQuestionAnalyzeInput } from "@/agentflow/agents/online/information-analyst/analyze-helpers";
import { resolveIdentityField } from "./field-catalog";
import type { PipelineToolResults, ToolRunResult } from "./types";

export const toolRunToAnalystResult = (
    run: ToolRunResult
): InformationAnalystResult => ({
    answer: run.answer,
    citations: run.citations,
    confidence: run.confidence,
    insufficientEvidence: run.insufficientEvidence,
    blocks: run.blocks,
});

export const pickToolResultForSubQuestion = (
    input: SubQuestionAnalyzeInput,
    toolResults?: PipelineToolResults | null
): ToolRunResult | null => {
    if (!toolResults) return null;

    if (input.slotId) {
        const slotRun = toolResults[`slot_${input.slotId}`];
        if (slotRun) return slotRun;
    }

    const profile =
        input.queryType ??
        resolveAnalystQueryProfile({
            userQuestion: input.userQuestion,
            subTasks: [input.userQuestion],
        });

    if (profile === "enumeration" && toolResults.enumeration) {
        return toolResults.enumeration;
    }

    const ageField = resolveIdentityField(input.userQuestion);
    if (
        profile === "identity" &&
        ageField?.toolId === "compute_age_from_hits" &&
        toolResults.age
    ) {
        return toolResults.age;
    }

    if (toolResults.web) return toolResults.web;

    return null;
};
