import type { StructuredToolInterface } from "@langchain/core/tools";
import { listVaultFilesTool } from "./list-vault";
import { retrieveCorpusTool } from "./retrieve-corpus";
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

/** FamBrain 在线能力对应的 LangChain StructuredTool（≥4 个，主 pipeline 仍走 LangGraph 节点） */
export const createFambrainTools = (): StructuredToolInterface[] => [
    retrieveCorpusTool,
    rememberUserFactTool,
    recallUserFactTool,
    listVaultFilesTool,
    summarizeTextTool,
];

export const FAMBRAIN_TOOL_NAMES = [
    "retrieve_corpus",
    "remember_user_fact",
    "recall_user_fact",
    "list_vault_files",
    "summarize_text",
] as const;
