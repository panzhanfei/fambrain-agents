import { AGENT_LOG_LABEL_IN, AGENT_LOG_LABEL_OUT, logAgentIn, logAgentOut } from "@fambrain/agent-shared/agent-log";

const AGENT = "KnowledgeIndexer" as const;

/** 离线入库师：进入（phase 为业务阶段说明，写入 payload） */
export const logIndexerIn = (phase: string, data: Record<string, unknown> = {}): void => {
    logAgentIn(AGENT, AGENT_LOG_LABEL_IN, { phase, ...data });
};

/** 离线入库师：出去 */
export const logIndexerOut = (phase: string, data: Record<string, unknown> = {}): void => {
    logAgentOut(AGENT, AGENT_LOG_LABEL_OUT, { phase, ...data });
};

/** @deprecated 中间步骤不再打印 */
export const logIndexerStep = (_step: string, _data: unknown): void => {
    /* no-op */
};
