import { logAgentIn, logAgentOut } from "@fambrain/agent-shared/agent-log";
import { organizeHits } from "./organize-hits";
import type { ContentOrganizerInput, ContentOrganizerResult, } from "./prompt";
import { parseKnowledgeHits } from "./schema";
export const organizeKnowledge = (input: ContentOrganizerInput): ContentOrganizerResult => {
    logAgentIn("ContentOrganizer", "整理请求", {
        hitCount: input.hits.length,
        coverage: input.coverage,
    });
    const validated = parseKnowledgeHits(input.hits);
    const beforeCount = validated.length;
    const hits = organizeHits(validated);
    const dedupedCount = Math.max(0, beforeCount - hits.length);
    let coverage = input.coverage;
    if (hits.length === 0) {
        coverage = "none";
    }
    const result: ContentOrganizerResult = {
        hits,
        coverage,
        notes: input.notes,
        dedupedCount,
    };
    logAgentOut("ContentOrganizer", "整理结果", {
        beforeCount,
        afterCount: hits.length,
        dedupedCount,
        coverage: result.coverage,
        paths: hits.map((h) => h.path),
    });
    return result;
};
