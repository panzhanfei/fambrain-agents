import { logAgentIn, logAgentOut, logAgentStep } from "@fambrain/agent-shared/agent-log";

const AGENT = "KnowledgeIndexer" as const;

/** 离线入库师：入口参数 */
export const logIndexerIn = (label: string, data: unknown): void => {
    logAgentIn(AGENT, label, data);
};

/** 离线入库师：最终结果 */
export const logIndexerOut = (label: string, data: unknown): void => {
    logAgentOut(AGENT, label, data);
};

/** 离线入库师：中间步骤（LOG_LEVEL=info 时也打印） */
export const logIndexerStep = (step: string, data: unknown): void => {
    logAgentStep(AGENT, step, data);
};
