/**
 * Agent 运行时配置，仅从环境变量读取。
 * 应在服务端使用（Route Handler、Server Action 等），勿在 Client Component 中导入。
 */
import process from "node:process";
import { z } from "zod";
import {
    resolveOllamaBaseUrl,
    resolveOpenAiChatCompletionsUrl,
} from "./service-url";

const DEFAULT_OPENAI_BASE_URL = "https://api.deepseek.com";
const DEFAULT_OPENAI_MODEL = "deepseek-v4-flash";

const envSchema = z
    .object({
        OLLAMA_BASE_URL: z
            .string()
            .default("http://127.0.0.1:11434")
            .transform((s) => s.trim())
            .refine((s) => {
                try {
                    new URL(s);
                    return true;
                } catch {
                    return false;
                }
            }, "OLLAMA_BASE_URL must be a valid URL"),
        OLLAMA_MODEL: z.string().default("qwen2.5:14b").transform((s) => s.trim()),
        /** 入口接线员；不设置则沿用 OLLAMA_MODEL */
        OLLAMA_MODEL_INTAKE_COORDINATOR: z
            .string()
            .optional()
            .transform((s) => (s === undefined ? undefined : s.trim()))
            .refine(
                (s) => s === undefined || s.length > 0,
                "if set, must be non-empty"
            ),
        /** 向量嵌入模型（RAG / 入库）；不设置则用 bge-m3（1024 维） */
        OLLAMA_MODEL_EMBED: z
            .string()
            .optional()
            .transform((s) => (s === undefined ? undefined : s.trim()))
            .refine(
                (s) => s === undefined || s.length > 0,
                "if set, must be non-empty"
            ),
        /** 流式聊天是否请求 Ollama thinking；部分模型/旧版 Ollama 不支持，可设 false（仍会在支持时由服务端自动降级重试） */
        OLLAMA_STREAM_THINK: z
            .string()
            .optional()
            .transform((raw) => {
                if (raw === undefined) return true;
                const s = raw.trim().toLowerCase();
                if (s === "" || s === "1" || s === "true" || s === "yes")
                    return true;
                if (s === "0" || s === "false" || s === "no") return false;
                return true;
            }),
        /**
         * 在线 Chat Completions 提供方。默认 ollama。
         * openai = OpenAI 兼容 HTTP（DeepSeek 等）；须显式切换，失败不回落到 Ollama。
         */
        CHAT_PROVIDER: z.preprocess((raw) => {
            if (raw === undefined || raw === null || String(raw).trim() === "")
                return "ollama";
            const s = String(raw).trim().toLowerCase();
            if (s === "openai-compat" || s === "openai_compat") return "openai";
            return s;
        }, z.enum(["ollama", "openai"])),
        OPENAI_BASE_URL: z
            .string()
            .optional()
            .transform((s) => (s === undefined ? undefined : s.trim())),
        OPENAI_API_KEY: z
            .string()
            .optional()
            .transform((s) => (s === undefined ? undefined : s.trim())),
        DEEPSEEK_API_KEY: z
            .string()
            .optional()
            .transform((s) => (s === undefined ? undefined : s.trim())),
        OPENAI_MODEL: z
            .string()
            .optional()
            .transform((s) => (s === undefined ? undefined : s.trim())),
    })
    .superRefine((data, ctx) => {
        if (data.CHAT_PROVIDER !== "openai") return;
        const key =
            data.OPENAI_API_KEY?.trim() || data.DEEPSEEK_API_KEY?.trim() || "";
        if (!key) {
            ctx.addIssue({
                code: "custom",
                message:
                    "CHAT_PROVIDER=openai 时必须设置 OPENAI_API_KEY 或 DEEPSEEK_API_KEY（禁止静默回落到 Ollama）",
                path: ["OPENAI_API_KEY"],
            });
        }
        const base = data.OPENAI_BASE_URL || DEFAULT_OPENAI_BASE_URL;
        try {
            new URL(base);
        } catch {
            ctx.addIssue({
                code: "custom",
                message: "OPENAI_BASE_URL must be a valid URL",
                path: ["OPENAI_BASE_URL"],
            });
        }
        if (data.OPENAI_MODEL !== undefined && data.OPENAI_MODEL.length === 0) {
            ctx.addIssue({
                code: "custom",
                message: "OPENAI_MODEL if set must be non-empty",
                path: ["OPENAI_MODEL"],
            });
        }
    });

export type ChatProvider = "ollama" | "openai";

export type OpenAiCompatChatConfig = {
    /** 已去掉末尾 `/` 的根地址，如 `https://api.deepseek.com` */
    baseUrl: string;
    /** `POST` Chat Completions，如 `https://api.deepseek.com/chat/completions` */
    chatCompletionsUrl: string;
    apiKey: string;
    model: string;
};

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
    chat: {
        provider: ChatProvider;
        /** provider=openai 时必有；ollama 时为 null */
        openai: OpenAiCompatChatConfig | null;
    };
};

let cached: BrainServiceConfig | null = null;

const buildConfig = (parsed: z.infer<typeof envSchema>): BrainServiceConfig => {
    const baseUrl = parsed.OLLAMA_BASE_URL.replace(/\/+$/, "");
    const defaultModel = parsed.OLLAMA_MODEL;
    const intake = parsed.OLLAMA_MODEL_INTAKE_COORDINATOR || defaultModel;
    const embed = parsed.OLLAMA_MODEL_EMBED || "bge-m3";
    let openai: OpenAiCompatChatConfig | null = null;
    if (parsed.CHAT_PROVIDER === "openai") {
        const openaiBase = (
            parsed.OPENAI_BASE_URL || DEFAULT_OPENAI_BASE_URL
        ).replace(/\/+$/, "");
        openai = {
            baseUrl: openaiBase,
            chatCompletionsUrl: resolveOpenAiChatCompletionsUrl(openaiBase),
            apiKey:
                parsed.OPENAI_API_KEY?.trim() ||
                parsed.DEEPSEEK_API_KEY?.trim() ||
                "",
            model: parsed.OPENAI_MODEL || DEFAULT_OPENAI_MODEL,
        };
    }
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
        chat: {
            provider: parsed.CHAT_PROVIDER,
            openai,
        },
    };
};

export const resetBrainServiceConfigCache = (): void => {
    cached = null;
};

export const getBrainServiceConfig = (): BrainServiceConfig => {
    if (cached) return cached;
    process.env.OLLAMA_BASE_URL = resolveOllamaBaseUrl();
    const parsed = envSchema.parse(process.env);
    cached = buildConfig(parsed);
    return cached;
};

export const formatChatProviderStartupLine = (
    cfg: BrainServiceConfig
): string => {
    if (cfg.chat.provider === "openai" && cfg.chat.openai) {
        return `chat provider=openai model=${cfg.chat.openai.model} base=${cfg.chat.openai.baseUrl}；embed/vision/Mem0 仍走 Ollama embed=${cfg.ollama.models.embed}`;
    }
    return `chat provider=ollama chat=${cfg.ollama.models.intakeCoordinator} embed=${cfg.ollama.models.embed}`;
};

export {
    resolveOllamaBaseUrl,
    resolveQdrantUrl,
    resolveBrainServicePort,
    resolveBrainServiceUrl,
    resolveOpenAiChatCompletionsUrl,
} from "./service-url";
export {
    buildLangGraphRunConfig,
    configureLangSmithTracing,
    formatLangSmithStartupLine,
    getLangSmithStatus,
    type LangGraphRunConfig,
    type LangSmithStatus,
} from "./langsmith";
