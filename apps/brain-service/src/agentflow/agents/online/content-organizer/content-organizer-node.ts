import { resolveQueryProfile } from "@/agentflow/agents/online/knowledge-manager";
import { ENUMERATION_EXHAUSTIVE_PAGE_SIZE } from "@/agentflow/agents/online/knowledge-manager/list/list-corpus-entries";
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
    const paginatedList =
        decision?.listIntent === "exhaustive" ||
        decision?.listIntent === "continue";
    const pageFromMeta = state.enumerationMeta?.pageSize;
    const maxHitsOverride = paginatedList
        ? decision.enumerationPageSize ??
          pageFromMeta ??
          ENUMERATION_EXHAUSTIVE_PAGE_SIZE
        : queryProfile === "enumeration" && pageFromMeta
          ? pageFromMeta
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
