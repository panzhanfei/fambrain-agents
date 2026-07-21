"use client";

import type { PipelineStepName } from "@fambrain/brain-types";
import {
    AGENT_LABELS,
    formatTokenSummary,
    type ConversationLogBundle,
    type ConversationTurnLog,
} from "@/lib/chat/conversation-logs";

const STEP_LABELS: Record<PipelineStepName, string> = {
    prepare_turn_start: "准备上下文",
    repeat_question_guard: "同问短路",
    prepare_pipeline_memory: "加载记忆",
    repeat_respond_early: "复用历史答",
    intake: "理解问题",
    user_fact: "读取记忆",
    retrieval: "检索知识库",
    plan_executor: "执行计划",
    fact_checker: "核查证据",
    content_summarizer: "生成摘要",
    content_organizer: "整理证据",
    analyst: "生成回答",
    persist_turn_end: "写入记忆",
};

const formatDuration = (ms: number): string => {
    if (ms >= 1000)
        return `${(ms / 1000).toFixed(1)}s`;
    return `${ms}ms`;
};

const formatClock = (iso: string): string => {
    try {
        return new Date(iso).toLocaleTimeString("zh-CN", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
        });
    }
    catch {
        return iso;
    }
};

type ConversationLogPanelProps = {
    open: boolean;
    onClose: () => void;
    conversationTitle: string;
    bundle: ConversationLogBundle | null;
    liveTurnId?: string | null;
};

const TurnSummary = ({ turn }: { turn: ConversationTurnLog }) => {
    const timing = turn.timing;
    const nodeEntries = timing
        ? (Object.entries(timing.nodes ?? {}) as [PipelineStepName, number][]).filter(([, ms]) => ms > 0)
        : [];
    const tokenText = formatTokenSummary(timing);

    return (
        <div className="mt-3 rounded-xl border border-[#e5e7eb] bg-[#f9fafb] p-3 text-[12px] text-[#374151]">
            <div className="flex flex-wrap gap-x-3 gap-y-1 font-medium text-[#111827]">
                {timing ? (
                    <>
                        <span>总耗时 {formatDuration(timing.totalMs)}</span>
                        {timing.ttftMs != null ? (
                            <span>首字 {formatDuration(timing.ttftMs)}</span>
                        ) : null}
                        {timing.clientTotalMs != null ? (
                            <span>全链路 {formatDuration(timing.clientTotalMs)}</span>
                        ) : null}
                    </>
                ) : turn.status === "running" ? (
                    <span className="text-[#4f46e5]">运行中…</span>
                ) : null}
            </div>
            {tokenText ? (
                <div className="mt-1.5 text-[#6b7280]">{tokenText}</div>
            ) : null}
            {nodeEntries.length > 0 ? (
                <ul className="mt-2 grid grid-cols-2 gap-1.5">
                    {nodeEntries.map(([name, ms]) => (
                        <li
                            key={name}
                            className="flex items-center justify-between rounded-lg bg-white px-2 py-1 text-[11px]"
                        >
                            <span className="text-[#6b7280]">{STEP_LABELS[name] ?? name}</span>
                            <span className="font-mono text-[#111827]">{formatDuration(ms)}</span>
                        </li>
                    ))}
                </ul>
            ) : null}
        </div>
    );
};

export const ConversationLogPanel = ({
    open,
    onClose,
    conversationTitle,
    bundle,
    liveTurnId,
}: ConversationLogPanelProps) => {
    if (!open)
        return null;

    const turns = bundle?.turns ?? [];

    return (
        <aside
            className="absolute inset-y-0 right-0 z-30 flex w-full max-w-md flex-col border-l border-[#e5e7eb] bg-[#fafafa] shadow-xl"
            aria-label="对话运行日志"
        >
            <header className="flex shrink-0 items-center justify-between border-b border-[#eceeef] px-4 py-3">
                <div className="min-w-0">
                    <h2 className="text-[14px] font-semibold text-[#111827]">运行日志</h2>
                    <p className="truncate text-[12px] text-[#9ca3af]">{conversationTitle || "新对话"}</p>
                </div>
                <button
                    type="button"
                    onClick={onClose}
                    className="rounded-lg px-2 py-1 text-[12px] text-[#6b7280] hover:bg-black/[0.04]"
                >
                    关闭
                </button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
                {turns.length === 0 ? (
                    <p className="py-8 text-center text-[13px] text-[#9ca3af]">
                        发送消息后，这里会实时显示本轮 Agent 日志、耗时与 Token。
                    </p>
                ) : (
                    <ul className="space-y-5">
                        {turns.map((turn, index) => (
                            <li key={turn.turnId} className="rounded-2xl border border-[#e5e7eb] bg-white p-3 shadow-sm">
                                <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                        <div className="text-[11px] font-medium uppercase tracking-wide text-[#9ca3af]">
                                            第 {index + 1} 轮
                                            {liveTurnId === turn.turnId ? (
                                                <span className="ml-2 text-[#4f46e5]">● 进行中</span>
                                            ) : null}
                                        </div>
                                        <p className="mt-1 line-clamp-2 text-[13px] font-medium text-[#111827]">
                                            {turn.userQuestion}
                                        </p>
                                    </div>
                                    <span
                                        className={[
                                            "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium",
                                            turn.status === "done"
                                                ? "bg-emerald-50 text-emerald-700"
                                                : turn.status === "error"
                                                  ? "bg-red-50 text-red-700"
                                                  : "bg-indigo-50 text-indigo-700",
                                        ].join(" ")}
                                    >
                                        {turn.status === "done" ? "完成" : turn.status === "error" ? "失败" : "运行中"}
                                    </span>
                                </div>

                                {turn.steps.length > 0 ? (
                                    <ol className="mt-3 flex flex-wrap gap-1.5">
                                        {turn.steps.map((step) => (
                                            <li
                                                key={`${step.name}-${step.status}`}
                                                className={[
                                                    "rounded-full px-2 py-0.5 text-[10px]",
                                                    step.status === "done"
                                                        ? "bg-[#eef2ff] text-[#4338ca]"
                                                        : "bg-[#f3f4f6] text-[#6b7280] animate-pulse",
                                                ].join(" ")}
                                            >
                                                {STEP_LABELS[step.name] ?? step.name}
                                                {step.durationMs != null
                                                    ? ` ${formatDuration(step.durationMs)}`
                                                    : ""}
                                            </li>
                                        ))}
                                    </ol>
                                ) : null}

                                <TurnSummary turn={turn} />

                                {turn.entries.length > 0 ? (
                                    <ul className="mt-3 max-h-56 space-y-2 overflow-y-auto rounded-xl bg-[#0f172a] p-2.5 font-mono text-[11px] leading-relaxed text-[#e2e8f0]">
                                        {turn.entries.map((entry) => (
                                            <li key={entry.id} className="border-b border-white/5 pb-2 last:border-0 last:pb-0">
                                                <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-[#94a3b8]">
                                                    <span>{formatClock(entry.at)}</span>
                                                    <span className="text-[#cbd5e1]">
                                                        {AGENT_LABELS[entry.agent] ?? entry.agent}
                                                    </span>
                                                    <span className={entry.direction === "in" ? "text-sky-400" : "text-emerald-400"}>
                                                        {entry.direction === "in" ? "进入" : "出去"}
                                                    </span>
                                                    {entry.label ? (
                                                        <span className="text-[#64748b]">{entry.label}</span>
                                                    ) : null}
                                                </div>
                                                {entry.preview ? (
                                                    <pre className="mt-1 whitespace-pre-wrap break-all text-[#f8fafc]">
                                                        {entry.preview}
                                                    </pre>
                                                ) : null}
                                            </li>
                                        ))}
                                    </ul>
                                ) : null}

                                {turn.error ? (
                                    <p className="mt-2 text-[12px] text-red-600">{turn.error}</p>
                                ) : null}
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </aside>
    );
};
