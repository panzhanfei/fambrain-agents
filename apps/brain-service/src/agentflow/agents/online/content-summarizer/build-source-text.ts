import type { InformationAnalystInput } from "@/agentflow/brain-service/online/information-analyst";
import type { IntakeRoutingDecision } from "@/agentflow/brain-service/online/intake-coordinator";
export const buildSummarizeSourceText = (input: {
    userQuestion: string;
    decision: IntakeRoutingDecision;
    hits: InformationAnalystInput["hits"];
}): {
    text: string;
    sourceLabel: string | null;
} => {
    if (input.hits.length > 0) {
        const parts = input.hits.map((h, i) => {
            const header = `### 片段 ${i + 1}: ${h.title}\n路径: ${h.path}`;
            return `${header}\n\n${h.excerpt}`;
        });
        return {
            text: parts.join("\n\n---\n\n"),
            sourceLabel: input.decision.searchQuery || input.userQuestion,
        };
    }
    return {
        text: input.userQuestion,
        sourceLabel: null,
    };
};
