import { formatLangSmithStartupLine, type LangSmithStatus, } from "@fambrain/agent-config/langsmith";

export const logLangSmithStartup = (langSmith: LangSmithStatus, log: (message: string) => void = console.log, prefix = "[@fambrain/agents]"): void => {
    const line = formatLangSmithStartupLine(langSmith);
    if (line) {
        log(`${prefix} ${line}`);
        return;
    }
    if (langSmith.apiKeyConfigured) {
        log(`${prefix} LangSmith API key 已配置但 tracing 关闭（LANGSMITH_TRACING=false）`);
    }
};
