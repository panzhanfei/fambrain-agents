import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ChatOllama } from "@langchain/ollama";
import type { DbChatTurn } from "@fambrain/agent-types";
import { getMemoryConfig } from "../config";
import type { SessionSummaryRecord } from "./types";
/**
 * LangMem 在官方仅有 Python SDK；此处用 ChatOllama 会话摘要实现同等职责：
 * 长对话压缩为 summary，Intake / Analyst 注入摘要 + 保留最近 N 轮原文。
 */
const SUMMARY_SYSTEM = `你是 FamBrain 的会话记忆管理器（LangMem 风格）。
将对话历史压缩为简洁中文摘要，保留：用户身份/偏好、已讨论的项目或话题、关键结论、待澄清点。
不要编造；只写对话中出现过的事实。输出纯文本，不要 JSON。`;
const sessionFilePath = (conversationId: string): string => {
    const safe = conversationId.replace(/[^a-zA-Z0-9_-]/g, "_");
    return path.join(getMemoryConfig().langMemSessionsDir, `${safe}.json`);
};
const formatTurns = (turns: DbChatTurn[]): string => {
    return turns
        .map((t) => `${t.role === "user" ? "用户" : "助手"}：${t.content}`)
        .join("\n");
};
export const loadSessionSummary = async (conversationId: string): Promise<string | null> => {
    const cfg = getMemoryConfig();
    if (!cfg.langMemEnabled || !conversationId)
        return null;
    try {
        const raw = await readFile(sessionFilePath(conversationId), "utf8");
        const parsed = JSON.parse(raw) as SessionSummaryRecord;
        const summary = parsed.summary?.trim();
        return summary && summary.length > 0 ? summary : null;
    }
    catch {
        return null;
    }
};
export const trimHistoryForIntake = (history: DbChatTurn[]): DbChatTurn[] => {
    const cfg = getMemoryConfig();
    if (!cfg.langMemEnabled) {
        return history.length > 40 ? history.slice(-40) : history;
    }
    const keep = cfg.langMemKeepRecentTurns * 2;
    return history.length > keep ? history.slice(-keep) : history;
};
export const summarizeSessionTurns = async (previousSummary: string | null, turns: DbChatTurn[]): Promise<string> => {
    const cfg = getMemoryConfig();
    const llm = new ChatOllama({
        baseUrl: cfg.ollamaBaseUrl,
        model: cfg.ollamaChatModel,
        temperature: 0.2,
    });
    const body = [
        previousSummary
            ? `已有会话摘要：\n${previousSummary}\n\n请合并以下新对话：`
            : "请摘要以下对话：",
        formatTurns(turns),
    ].join("\n\n");
    const msg = await llm.invoke([
        new SystemMessage(SUMMARY_SYSTEM),
        new HumanMessage(body),
    ]);
    const text = typeof msg.content === "string"
        ? msg.content.trim()
        : Array.isArray(msg.content)
            ? msg.content
                .map((p) => typeof p === "string"
                ? p
                : p &&
                    typeof p === "object" &&
                    "text" in p &&
                    typeof (p as {
                        text: string;
                    }).text === "string"
                    ? (p as {
                        text: string;
                    }).text
                    : "")
                .join("")
                .trim()
            : "";
    return text || previousSummary || "";
};
export const persistSessionSummary = async (conversationId: string, history: DbChatTurn[], assistantAnswer: string): Promise<void> => {
    const cfg = getMemoryConfig();
    if (!cfg.langMemEnabled || !conversationId)
        return;
    const turnCount = history.length + 1;
    if (turnCount < cfg.langMemSummarizeAfterTurns)
        return;
    try {
        await mkdir(cfg.langMemSessionsDir, { recursive: true });
        const previous = await loadSessionSummary(conversationId);
        const fullTurns: DbChatTurn[] = [
            ...history,
            { role: "assistant", content: assistantAnswer },
        ];
        const olderCount = Math.max(0, fullTurns.length - cfg.langMemKeepRecentTurns * 2);
        const toSummarize = fullTurns.slice(0, olderCount);
        if (toSummarize.length === 0 && previous)
            return;
        const summary = await summarizeSessionTurns(previous, toSummarize);
        if (!summary)
            return;
        const record: SessionSummaryRecord = {
            conversationId,
            summary,
            updatedAt: new Date().toISOString(),
        };
        await writeFile(sessionFilePath(conversationId), JSON.stringify(record, null, 2), "utf8");
    }
    catch (e) {
        console.warn("[LangMem] persist failed:", e instanceof Error ? e.message : String(e));
    }
};
