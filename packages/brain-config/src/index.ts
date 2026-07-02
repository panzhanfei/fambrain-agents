/**
 * Agent 运行时配置，仅从环境变量读取。
 * 应在服务端使用（Route Handler、Server Action 等），勿在 Client Component 中导入。
 */
import process from "node:process";
import { z } from "zod";
import { resolveOllamaBaseUrl } from "./service-url";
const envSchema = z.object({
    OLLAMA_BASE_URL: z
        .string()
        .default("http://127.0.0.1:11434")
        .transform((s) => s.trim())
        .refine((s) => {
        try {
            new URL(s);
            return true;
        }
        catch {
            return false;
        }
    }, "OLLAMA_BASE_URL must be a valid URL"),
    OLLAMA_MODEL: z.string().default("qwen2.5:14b").transform((s) => s.trim()),
    /** 入口接线员；不设置则沿用 OLLAMA_MODEL */
    OLLAMA_MODEL_INTAKE_COORDINATOR: z
        .string()
        .optional()
        .transform((s) => (s === undefined ? undefined : s.trim()))
        .refine((s) => s === undefined || s.length > 0, "if set, must be non-empty"),
    /** 向量嵌入模型（RAG / 入库）；不设置则用 nomic-embed-text */
    OLLAMA_MODEL_EMBED: z
        .string()
        .optional()
        .transform((s) => (s === undefined ? undefined : s.trim()))
        .refine((s) => s === undefined || s.length > 0, "if set, must be non-empty"),
    /** 流式聊天是否请求 Ollama thinking；部分模型/旧版 Ollama 不支持，可设 false（仍会在支持时由服务端自动降级重试） */
    OLLAMA_STREAM_THINK: z
        .string()
        .optional()
        .transform((raw) => {
        if (raw === undefined)
            return true;
        const s = raw.trim().toLowerCase();
        if (s === "" || s === "1" || s === "true" || s === "yes")
            return true;
        if (s === "0" || s === "false" || s === "no")
            return false;
        return true;
    }),
});
export type BrainServiceConfig = {
    ollama: {
        /** 已去掉末尾 `/` 的根地址，如 `http://127.0.0.1:11434` */
        baseUrl: string;
        /** 列出本地模型：`GET ${baseUrl}/api/tags` */
        tagsEndpoint: string;
        /** 流式/对话：`POST ${baseUrl}/api/chat`（Ollama 原生 HTTP API） */
        chatEndpoint: string;
        /** 生成嵌入：`POST ${baseUrl}/api/embed` */
        embedEndpoint: string;
        models: {
            default: string;
            intakeCoordinator: string;
            embed: string;
        };
        /** 流式对话是否带 thinking；不支持时可关或依赖自动降级 */
        streamThink: boolean;
    };
};
let cached: BrainServiceConfig | null = null;
const buildConfig = (parsed: z.infer<typeof envSchema>): BrainServiceConfig => {
    const baseUrl = parsed.OLLAMA_BASE_URL.replace(/\/+$/, "");
    const defaultModel = parsed.OLLAMA_MODEL;
    const intake = parsed.OLLAMA_MODEL_INTAKE_COORDINATOR || defaultModel;
    const embed = parsed.OLLAMA_MODEL_EMBED || "nomic-embed-text";
    return {
        ollama: {
            baseUrl,
            tagsEndpoint: `${baseUrl}/api/tags`,
            chatEndpoint: `${baseUrl}/api/chat`,
            embedEndpoint: `${baseUrl}/api/embed`,
            models: {
                default: defaultModel,
                intakeCoordinator: intake,
                embed,
            },
            streamThink: parsed.OLLAMA_STREAM_THINK,
        },
    };
};
export const getBrainServiceConfig = (): BrainServiceConfig => {
    if (cached)
        return cached;
    process.env.OLLAMA_BASE_URL = resolveOllamaBaseUrl();
    const parsed = envSchema.parse(process.env);
    cached = buildConfig(parsed);
    return cached;
};
export { resolveOllamaBaseUrl, resolveChromaServerUrl, resolveBrainServicePort, resolveBrainServiceUrl, } from "./service-url";
export { buildLangGraphRunConfig, configureLangSmithTracing, formatLangSmithStartupLine, getLangSmithStatus, type LangGraphRunConfig, type LangSmithStatus, } from "./langsmith";
