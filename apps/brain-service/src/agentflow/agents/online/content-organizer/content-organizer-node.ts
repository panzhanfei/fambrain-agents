import { resolveQueryProfile } from "@/agentflow/agents/online/knowledge-manager";
import { organizeKnowledge } from "./organize-knowledge";
import type { PipelineGraphState } from "@/agentflow/pipeline/graph/state";

/** LangGraph contentOrganizer 节点 */
export const runContentOrganizerNode = async (
    state: PipelineGraphState
): Promise<Partial<PipelineGraphState>> => {
    const decision = state.decision;
    const queryProfile = decision
        ? resolveQueryProfile(
              decision.searchQuery || state.userQuestion,
              decision.subTasks,
              decision.queryType
          )
        : undefined;
    const maxHitsOverride =
        decision?.listIntent === "exhaustive" ||
        decision?.listIntent === "continue"
            ? decision.enumerationPageSize
            : undefined;
    const organized = organizeKnowledge({
        hits: state.hits,
        coverage: state.coverage,
        notes: state.notes,
        queryProfile,
        maxHitsOverride,
    });
    return {
        hits: organized.hits,
        coverage: organized.coverage,
        notes: organized.notes,
    };
};
