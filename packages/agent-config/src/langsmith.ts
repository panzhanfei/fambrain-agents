/**
 * LangSmith 链路追踪：通过环境变量启用，trace 上报至 https://smith.langchain.com
 *
 * 启用条件：已配置 LANGSMITH_API_KEY（或 LANGCHAIN_API_KEY），且未显式 LANGSMITH_TRACING=false
 */
export type LangSmithStatus = {
    enabled: boolean;
    project: string | null;
    apiKeyConfigured: boolean;
    endpoint: string;
    uiUrl: string;
};

export type LangGraphRunConfig = {
    runName?: string;
    tags?: string[];
    metadata?: Record<string, string | number | boolean>;
};

let cachedStatus: LangSmithStatus | null = null;

const isExplicitlyOff = (raw: string | undefined): boolean => {
    if (!raw)
        return false;
    const s = raw.trim().toLowerCase();
    return s === "0" || s === "false" || s === "no" || s === "off";
};

export const configureLangSmithTracing = (): LangSmithStatus => {
    if (cachedStatus)
        return cachedStatus;
    const apiKey = process.env.LANGSMITH_API_KEY?.trim()
        || process.env.LANGCHAIN_API_KEY?.trim()
        || "";
    const endpoint = (process.env.LANGSMITH_ENDPOINT?.trim()
        || "https://api.smith.langchain.com").replace(/\/+$/, "");
    const project = process.env.LANGSMITH_PROJECT?.trim()
        || process.env.LANGCHAIN_PROJECT?.trim()
        || "fambrain";
    const tracingFlag = process.env.LANGSMITH_TRACING ?? process.env.LANGCHAIN_TRACING_V2;
    const enabled = Boolean(apiKey) && !isExplicitlyOff(tracingFlag);
    if (enabled) {
        process.env.LANGSMITH_TRACING = "true";
        process.env.LANGCHAIN_TRACING_V2 = "true";
        process.env.LANGSMITH_API_KEY = apiKey;
        process.env.LANGCHAIN_API_KEY = apiKey;
        process.env.LANGSMITH_PROJECT = project;
        process.env.LANGCHAIN_PROJECT = project;
        process.env.LANGSMITH_ENDPOINT = endpoint;
    }
    cachedStatus = {
        enabled,
        project: enabled ? project : null,
        apiKeyConfigured: Boolean(apiKey),
        endpoint,
        uiUrl: "https://smith.langchain.com",
    };
    return cachedStatus;
};

export const getLangSmithStatus = (): LangSmithStatus => {
    return cachedStatus ?? configureLangSmithTracing();
};

/** LangGraph stream / invoke 附加 run 元数据，便于 LangSmith UI 筛选 */
export const buildLangGraphRunConfig = (input: {
    conversationId?: string;
    corpusUserId?: string;
    actorUserId?: string;
    userQuestion?: string;
}): LangGraphRunConfig => {
    if (!getLangSmithStatus().enabled)
        return {};
    return {
        runName: "fambrain-pipeline",
        tags: ["fambrain", "online"],
        metadata: {
            conversationId: input.conversationId ?? "",
            corpusUserId: input.corpusUserId ?? "",
            actorUserId: input.actorUserId ?? "",
            userQuestion: (input.userQuestion ?? "").slice(0, 500),
        },
    };
};

export const formatLangSmithStartupLine = (status: LangSmithStatus): string | null => {
    if (!status.enabled)
        return null;
    return `LangSmith tracing ON · project=${status.project} · ${status.uiUrl}`;
};
