import { configureLangSmithTracing, type LangSmithStatus, } from "@fambrain/agent-config/langsmith";
import { resolveAgentsPort } from "@fambrain/agent-config/service-url";
import { loadRootEnv } from "./env";

export type AgentsRuntimeConfig = {
    langSmith: LangSmithStatus;
    port: number;
};

/** 服务 / CLI 入口：加载根 .env → LangSmith → 解析端口 */
export const bootstrapAgentsRuntime = (): AgentsRuntimeConfig => {
    loadRootEnv();
    return {
        langSmith: configureLangSmithTracing(),
        port: resolveAgentsPort(),
    };
};

/** Pipeline 等非 HTTP 入口：确保 env 与 LangSmith 已初始化 */
export const ensureAgentsRuntime = (): LangSmithStatus => {
    loadRootEnv();
    return configureLangSmithTracing();
};
