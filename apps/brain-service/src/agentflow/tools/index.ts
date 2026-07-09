import type { StructuredToolInterface } from "@langchain/core/tools";
import { computeAgeFromHitsTool } from "./compute-age-from-hits";
import { listVaultFilesTool } from "./list-vault";
import { retrieveCorpusTool } from "./retrieve-corpus";
import { searchWebTool } from "./search-web";
import { summarizeTextTool } from "./summarize-text";
import { recallUserFactTool, rememberUserFactTool } from "./user-fact";

export {
    getToolContext,
    runWithToolContext,
    type FambrainToolContext,
} from "./context";
export { retrieveCorpusTool } from "./retrieve-corpus";
export { rememberUserFactTool, recallUserFactTool } from "./user-fact";
export { listVaultFilesTool } from "./list-vault";
export { summarizeTextTool } from "./summarize-text";
export { computeAgeFromHitsTool } from "./compute-age-from-hits";
export { searchWebTool } from "./search-web";
export {
    ORCHESTRATED_TOOL_IDS,
    resolveOrchestratedTool,
    runOrchestratedSubQuestion,
    type OrchestratedToolId,
} from "./orchestrated/run-sub-question";
export {
    buildAgeAnswer,
    computeAgeYears,
    extractBirthOrAgeFromHits,
    extractBirthOrAgeFromText,
    isAgeSubQuestion,
    type BirthDate,
} from "./lib/compute-age";

/** FamBrain 在线能力对应的 LangChain StructuredTool（主 pipeline 仍走 LangGraph 编排节点 + orchestrated 工具表） */
export const createFambrainTools = (): StructuredToolInterface[] => [
    retrieveCorpusTool,
    computeAgeFromHitsTool,
    rememberUserFactTool,
    recallUserFactTool,
    listVaultFilesTool,
    summarizeTextTool,
    searchWebTool,
];

export const FAMBRAIN_TOOL_NAMES = [
    "retrieve_corpus",
    "compute_age_from_hits",
    "remember_user_fact",
    "recall_user_fact",
    "list_vault_files",
    "summarize_text",
    "search_web",
] as const;
