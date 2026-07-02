import { resolveQueryProfile } from "@/agentflow/brain-service/online/knowledge-manager/query-profile";
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
    const organized = organizeKnowledge({
        hits: state.hits,
        coverage: state.coverage,
        notes: state.notes,
        queryProfile,
    });
    return {
        hits: organized.hits,
        coverage: organized.coverage,
        notes: organized.notes,
    };
};
